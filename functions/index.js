const crypto = require("crypto");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const Razorpay = require("razorpay");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

if (!getApps().length) {
    initializeApp();
}
const db = getFirestore();

// Secrets managed securely via Cloud Secret Manager (v2)
// Loaded via: firebase functions:secrets:set RAZORPAY_KEY_SECRET
// Loaded via: firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
const razorpayKeySecret = defineSecret("RAZORPAY_KEY_SECRET");
const razorpayWebhookSecret = defineSecret("RAZORPAY_WEBHOOK_SECRET");

const RAZORPAY_KEY_ID = "rzp_live_U24HQteyWphATZ";

// Server-side authoritative catalog pricing (guarantees pricing integrity even if catalog collection is being indexed)
const SERVER_CATALOG_PRICING = {
    "saree-01": { priceInr: 18499, title: "Banarasi Handwoven Katan Silk Saree" },
    "saree-02": { priceInr: 24999, title: "Kanjeevaram Pure Gold Zari Silk Saree" },
    "saree-03": { priceInr: 12499, title: "Chanderi Handloom Floral Sheer Saree" },
    "jewel-01": { priceInr: 6899, title: "Kundan Polki Handcrafted Choker Set" },
    "jewel-02": { priceInr: 14500, title: "Temple Heritage Antique Gold Haram" },
    "jewel-03": { priceInr: 4200, title: "Meenakari Enamel Chandbali Earrings" },
    "clothes-01": { priceInr: 8999, title: "Raw Silk Embroidered Heritage Kurta Set" },
    "clothes-02": { priceInr: 16500, title: "Chanderi Silk Royal Kalidar Anarkali" },
    "clothes-03": { priceInr: 5499, title: "Tussar Silk Hand-Embroidered Dupatta" }
};

/**
 * Helper to fetch authoritative price for a product.
 * Always checks Firestore first; falls back to server catalog map.
 */
async function getAuthoritativeProduct(productId) {
    try {
        const docRef = db.collection("products").doc(productId);
        const snap = await docRef.get();
        if (snap.exists) {
            const data = snap.data();
            return {
                id: productId,
                priceInr: Number(data.priceInr || data.price || 0),
                title: data.editorialTitle || data.fullName || data.title || productId,
                category: data.category || "",
                variants: Array.isArray(data.variants) ? data.variants : [],
                inStock: data.inStock !== false
            };
        }
    } catch (e) {
        console.warn(`Firestore price lookup for ${productId} warning:`, e.message);
    }

    if (SERVER_CATALOG_PRICING[productId]) {
        return {
            id: productId,
            ...SERVER_CATALOG_PRICING[productId],
            category: "SAREES",
            variants: [],
            inStock: true
        };
    }

    return null;
}

/**
 * Idempotently locks stock for 1-of-1 ArtClusive / CUSTOM pieces upon payment confirmation.
 * Prevents double-execution between verifyRazorpayPayment and razorpayWebhook.
 */
async function lockArtClusiveStockForOrder(orderRef, orderData) {
    if (!orderData || orderData.stockLocked === true) {
        return;
    }

    const items = orderData.items || [];
    if (!Array.isArray(items) || items.length === 0) {
        if (orderRef) {
            await orderRef.update({ stockLocked: true });
        }
        return;
    }

    for (const item of items) {
        const pid = item.productId || item.id;
        if (!pid) continue;

        try {
            const productRef = db.collection("products").doc(pid);
            const productSnap = await productRef.get();
            if (!productSnap.exists) continue;

            const productData = productSnap.data() || {};
            const rawCategory = (productData.category || "").toString().trim().toUpperCase();
            const fullName = (productData.fullName || productData.editorialTitle || productData.title || "").toString();

            // Strict rule: Only auto-lock if product category is "CUSTOM" (or hand-painted 1-of-1 pieces).
            // Do NOT lock normal catalog sarees (e.g. Category.SAREES).
            const isArtClusive = rawCategory === "CUSTOM" ||
                rawCategory.includes("HAND") ||
                fullName.toLowerCase().includes("hand-paint") ||
                fullName.toLowerCase().includes("hand-print");

            if (!isArtClusive) {
                continue;
            }

            const variants = Array.isArray(productData.variants) ? [...productData.variants] : [];
            if (variants.length > 0) {
                const targetVariantId = item.variantId || item.selectedVariantId;
                const targetColorName = (item.variant || item.colorName || "").toString().trim().toLowerCase();

                let matchedIdx = -1;
                if (targetVariantId) {
                    matchedIdx = variants.findIndex(v => v && v.id === targetVariantId);
                }
                if (matchedIdx === -1 && targetColorName && targetColorName !== "standard") {
                    matchedIdx = variants.findIndex(v => v && (v.colorName || "").toString().trim().toLowerCase() === targetColorName);
                }
                if (matchedIdx === -1) {
                    matchedIdx = 0;
                }

                if (matchedIdx >= 0 && variants[matchedIdx]) {
                    variants[matchedIdx] = {
                        ...variants[matchedIdx],
                        inStock: false
                    };
                    await productRef.update({
                        variants: variants,
                        updatedAt: FieldValue.serverTimestamp()
                    });
                    console.log(`Stock locked for 1-of-1 ArtClusive product ${pid}, variant: ${variants[matchedIdx].colorName || matchedIdx}.`);
                }
            } else {
                await productRef.update({
                    inStock: false,
                    updatedAt: FieldValue.serverTimestamp()
                });
                console.log(`Stock locked for 1-of-1 ArtClusive product ${pid} (single item).`);
            }
        } catch (err) {
            console.error(`Failed to lock stock for product ${pid}:`, err);
        }
    }

    if (orderRef) {
        await orderRef.update({
            stockLocked: true,
            stockLockedAt: FieldValue.serverTimestamp()
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Centralized Order Pricing & Merchandising Rules
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_PRICING_CONFIG = {
    freeShippingThresholdInr: 2999,
    standardShippingFeeInr: 149,
    codTokenAmountInr: 299
};

/**
 * Authoritative server-side pricing calculator.
 * Computes subtotal, promo discount, insured express shipping, grand total,
 * and Cash on Delivery (COD) advance token / balance due.
 */
function calculateOrderPricing(subtotal, promoCode = "", options = {}) {
    const config = { ...DEFAULT_PRICING_CONFIG, ...options };
    const cleanSubtotal = Math.max(0, Math.round(Number(subtotal) || 0));

    // Promo code validation: FIRST10 gives 10% off (rounded)
    const cleanPromo = (promoCode || "").trim().toUpperCase();
    let discountInr = 0;
    if (cleanPromo === "FIRST10") {
        discountInr = Math.round(cleanSubtotal * 0.10);
    }

    // Shipping rules: Free shipping at or above threshold (₹2999), else flat shipping fee (₹149)
    let shippingInr = 0;
    if (cleanSubtotal > 0) {
        shippingInr = cleanSubtotal >= config.freeShippingThresholdInr ? 0 : config.standardShippingFeeInr;
    }

    const grandTotalInr = Math.max(0, cleanSubtotal - discountInr + shippingInr);
    const amountInPaise = Math.round(grandTotalInr * 100);

    // COD advance/token calculation (upfront token capped at grand total, remaining balance due on delivery)
    const codAdvanceInr = grandTotalInr > 0 ? Math.min(config.codTokenAmountInr, grandTotalInr) : 0;
    const codBalanceInr = Math.max(0, grandTotalInr - codAdvanceInr);

    return {
        subtotal: cleanSubtotal,
        subtotalInr: cleanSubtotal,
        discount: discountInr,
        discountInr: discountInr,
        shipping: shippingInr,
        shippingInr: shippingInr,
        freeShippingThresholdInr: config.freeShippingThresholdInr,
        standardShippingFeeInr: config.standardShippingFeeInr,
        grandTotal: grandTotalInr,
        grandTotalInr: grandTotalInr,
        amountInPaise: amountInPaise,
        promoCode: discountInr > 0 ? cleanPromo : null,
        codAdvanceInr: codAdvanceInr,
        codBalanceInr: codBalanceInr,
        balanceDueOnDeliveryInr: codBalanceInr
    };
}

/**
 * Helper to get Razorpay client instance using live key ID and secret.
 */
function getRazorpayClient() {
    const keySecret = razorpayKeySecret.value() || process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
        throw new HttpsError("internal", "Razorpay Key Secret is not configured in server environment.");
    }
    return new Razorpay({
        key_id: RAZORPAY_KEY_ID,
        key_secret: keySecret
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CALLABLE: createRazorpayOrder
// ─────────────────────────────────────────────────────────────────────────────
exports.createRazorpayOrder = onCall(
    { secrets: [razorpayKeySecret], cors: true },
    async (request) => {
        // Enforce user authentication
        if (!request.auth) {
            throw new HttpsError(
                "unauthenticated",
                "User must be securely signed in to create an order."
            );
        }

        const data = request.data || {};
        const clientItems = data.items || [];
        const shippingAddress = data.shippingAddress || {};
        const promoCode = (data.promoCode || "").trim().toUpperCase();

        if (!Array.isArray(clientItems) || clientItems.length === 0) {
            throw new HttpsError("invalid-argument", "Cart is empty. Please select an artisanal weave.");
        }

        // Strictly re-calculate subtotal on the server using authoritative product prices
        let subtotal = 0;
        const verifiedItems = [];

        for (const item of clientItems) {
            const pid = item.productId || item.id;
            const qty = Math.max(1, Math.min(10, Number(item.quantity || 1)));
            const product = await getAuthoritativeProduct(pid);

            if (!product || product.priceInr <= 0) {
                throw new HttpsError(
                    "not-found",
                    `Artisanal piece with ID '${pid}' could not be verified in store catalog.`
                );
            }

            // Reject if 1-of-1 selected variant or product is already claimed / out of stock
            const targetVariantId = item.variantId || item.selectedVariantId;
            const targetColorName = (item.variant || item.colorName || "").toString().trim().toLowerCase();
            const variants = product.variants || [];

            let matchedVariant = null;
            if (targetVariantId) {
                matchedVariant = variants.find(v => v && v.id === targetVariantId);
            }
            if (!matchedVariant && targetColorName && targetColorName !== "standard") {
                matchedVariant = variants.find(v => v && (v.colorName || "").toString().trim().toLowerCase() === targetColorName);
            }
            if (!matchedVariant && variants.length > 0) {
                matchedVariant = variants[0];
            }

            if (matchedVariant && matchedVariant.inStock === false) {
                throw new HttpsError(
                    "failed-precondition",
                    "This 1-of-1 piece has just been claimed."
                );
            }
            if (product.inStock === false) {
                throw new HttpsError(
                    "failed-precondition",
                    "This 1-of-1 piece has just been claimed."
                );
            }

            const itemTotal = product.priceInr * qty;
            subtotal += itemTotal;

            verifiedItems.push({
                productId: pid,
                variantId: targetVariantId || (matchedVariant ? matchedVariant.id : ""),
                title: product.title,
                variant: (matchedVariant && matchedVariant.colorName) || item.variant || item.colorName || "Standard",
                quantity: qty,
                unitPriceInr: product.priceInr,
                totalInr: itemTotal
            });
        }

        // Compute discount, shipping, and grand total via centralized pricing helper
        const pricing = calculateOrderPricing(subtotal, promoCode);
        const paymentMode = data.paymentMode === "PARTIAL_COD" ? "PARTIAL_COD" : "FULL_ONLINE";
        const isPartialCod = paymentMode === "PARTIAL_COD";
        const chargeAmountInPaise = isPartialCod ? (pricing.codAdvanceInr * 100) : pricing.amountInPaise;

        const currentYear = new Date().getFullYear();
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const firestoreOrderId = `ART-${currentYear}-${randomNum}`;

        // Create Live Razorpay Order
        const razorpay = getRazorpayClient();
        let rzpOrder;
        try {
            rzpOrder = await razorpay.orders.create({
                amount: chargeAmountInPaise,
                currency: "INR",
                receipt: firestoreOrderId,
                notes: {
                    userId: request.auth.uid,
                    firestoreOrderId: firestoreOrderId,
                    paymentMode: paymentMode,
                    promoCode: pricing.promoCode || "NONE"
                }
            });
        } catch (err) {
            console.error("Razorpay order creation error:", err);
            throw new HttpsError("internal", `Failed to create live Razorpay order: ${err.message || err}`);
        }

        // Write pending order document into Firestore
        const orderDoc = {
            orderId: firestoreOrderId,
            userId: request.auth ? request.auth.uid : null,
            razorpayOrderId: rzpOrder.id,
            items: verifiedItems,
            pricing: pricing,
            shippingAddress: {
                receiverName: shippingAddress.receiverName || "Customer",
                receiverPhone: shippingAddress.receiverPhone || "",
                houseFlat: shippingAddress.houseFlat || "",
                floor: shippingAddress.floor || "",
                street: shippingAddress.street || "",
                area: shippingAddress.area || "",
                city: shippingAddress.city || "",
                pinCode: shippingAddress.pinCode || ""
            },
            status: "PENDING",
            paymentStatus: isPartialCod ? "PENDING_ADVANCE" : "PENDING",
            paymentMethod: isPartialCod ? "PARTIAL_COD" : "RAZORPAY",
            paymentMode: paymentMode,
            advancePaidInr: isPartialCod ? pricing.codAdvanceInr : pricing.grandTotalInr,
            balanceDueOnDeliveryInr: isPartialCod ? pricing.codBalanceInr : 0,
            createdAt: FieldValue.serverTimestamp()
        };

        await db.collection("orders").doc(firestoreOrderId).set(orderDoc);

        return {
            razorpayOrderId: rzpOrder.id,
            amount: rzpOrder.amount,
            currency: "INR",
            firestoreOrderId: firestoreOrderId,
            grandTotalInr: pricing.grandTotalInr,
            codAdvanceInr: pricing.codAdvanceInr,
            codBalanceInr: pricing.codBalanceInr,
            balanceDueOnDeliveryInr: pricing.codBalanceInr,
            paymentMode: paymentMode,
            pricing: pricing
        };
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. CALLABLE: verifyRazorpayPayment
// ─────────────────────────────────────────────────────────────────────────────
exports.verifyRazorpayPayment = onCall(
    { secrets: [razorpayKeySecret], cors: true },
    async (request) => {
        const data = request.data || {};
        const {
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature,
            firestoreOrderId
        } = data;

        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !firestoreOrderId) {
            throw new HttpsError(
                "invalid-argument",
                "Missing required payment verification parameters."
            );
        }

        const keySecret = razorpayKeySecret.value() || process.env.RAZORPAY_KEY_SECRET;
        if (!keySecret) {
            throw new HttpsError("internal", "Server payment secret is missing.");
        }

        // Verify HMAC-SHA256 signature of razorpayOrderId|razorpayPaymentId
        const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
        const expectedSignature = crypto
            .createHmac("sha256", keySecret)
            .update(payload)
            .digest("hex");

        if (expectedSignature !== razorpaySignature) {
            console.error("Signature mismatch:", { expectedSignature, razorpaySignature });
            throw new HttpsError(
                "permission-denied",
                "Payment signature verification failed. Potential tampering detected."
            );
        }

        // Update Firestore order status based on paymentMode
        const orderRef = db.collection("orders").doc(firestoreOrderId);
        const orderSnap = await orderRef.get();
        const currentData = orderSnap.exists ? orderSnap.data() : {};
        const isPartialCod = currentData.paymentMethod === "PARTIAL_COD" || currentData.paymentMode === "PARTIAL_COD";

        const updateData = {
            status: "CONFIRMED",
            paymentStatus: isPartialCod ? "PARTIAL_PAID" : "PAID",
            razorpayPaymentId: razorpayPaymentId,
            razorpaySignature: razorpaySignature,
            paidAt: FieldValue.serverTimestamp()
        };
        if (isPartialCod) {
            updateData.advancePaidInr = currentData.advancePaidInr !== undefined ? currentData.advancePaidInr : (currentData.pricing?.codAdvanceInr || 0);
            updateData.balanceDueOnDeliveryInr = currentData.balanceDueOnDeliveryInr !== undefined ? currentData.balanceDueOnDeliveryInr : (currentData.pricing?.codBalanceInr || 0);
        }

        await orderRef.update(updateData);

        // Auto-lock stock for 1-of-1 ArtClusive / CUSTOM pieces
        await lockArtClusiveStockForOrder(orderRef, currentData);

        // Clear user cart in Firestore if authenticated
        if (request.auth && request.auth.uid) {
            try {
                await db.collection("users").doc(request.auth.uid).collection("cart").get()
                    .then(snapshot => {
                        const batch = db.batch();
                        snapshot.docs.forEach(docSnap => batch.delete(docSnap.ref));
                        return batch.commit();
                    });
            } catch (cartErr) {
                console.warn("Cart clearing non-critical error:", cartErr.message);
            }
        }

        return {
            success: true,
            orderId: firestoreOrderId,
            paymentId: razorpayPaymentId,
            paymentStatus: isPartialCod ? "PARTIAL_PAID" : "PAID",
            paymentMethod: isPartialCod ? "PARTIAL_COD" : "RAZORPAY",
            advancePaidInr: isPartialCod ? (currentData.advancePaidInr || currentData.pricing?.codAdvanceInr || 0) : (currentData.pricing?.grandTotalInr || 0),
            balanceDueOnDeliveryInr: isPartialCod ? (currentData.balanceDueOnDeliveryInr || currentData.pricing?.codBalanceInr || 0) : 0,
            grandTotalInr: currentData.pricing?.grandTotalInr || currentData.grandTotal || 0,
            message: isPartialCod
                ? "Partial COD advance verified and order confirmed."
                : "Payment successfully verified and commission confirmed."
        };
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. CALLABLE: createCodOrder
// ─────────────────────────────────────────────────────────────────────────────
exports.createCodOrder = onCall(
    { cors: true },
    async (request) => {
        const data = request.data || {};
        const clientItems = data.items || [];
        const shippingAddress = data.shippingAddress || {};
        const promoCode = (data.promoCode || "").trim().toUpperCase();

        if (!Array.isArray(clientItems) || clientItems.length === 0) {
            throw new HttpsError("invalid-argument", "Cart is empty. Please select an artisanal weave.");
        }

        // Strictly re-calculate subtotal on the server using authoritative product prices
        let subtotal = 0;
        const verifiedItems = [];

        for (const item of clientItems) {
            const pid = item.productId || item.id;
            const qty = Math.max(1, Math.min(10, Number(item.quantity || 1)));
            const product = await getAuthoritativeProduct(pid);

            if (!product || product.priceInr <= 0) {
                throw new HttpsError(
                    "not-found",
                    `Artisanal piece with ID '${pid}' could not be verified in store catalog.`
                );
            }

            const itemTotal = product.priceInr * qty;
            subtotal += itemTotal;

            verifiedItems.push({
                productId: pid,
                title: product.title,
                variant: item.variant || item.colorName || "Standard",
                quantity: qty,
                unitPriceInr: product.priceInr,
                totalInr: itemTotal
            });
        }

        // Compute discount, shipping, and grand total via centralized pricing helper
        const pricing = calculateOrderPricing(subtotal, promoCode);

        const currentYear = new Date().getFullYear();
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const firestoreOrderId = `ART-${currentYear}-${randomNum}`;

        const orderDoc = {
            orderId: firestoreOrderId,
            userId: request.auth ? request.auth.uid : null,
            items: verifiedItems,
            pricing: pricing,
            shippingAddress: {
                receiverName: shippingAddress.receiverName || "Customer",
                receiverPhone: shippingAddress.receiverPhone || "",
                houseFlat: shippingAddress.houseFlat || "",
                floor: shippingAddress.floor || "",
                street: shippingAddress.street || "",
                area: shippingAddress.area || "",
                city: shippingAddress.city || "",
                pinCode: shippingAddress.pinCode || ""
            },
            paymentMethod: "COD",
            paymentStatus: "PENDING_COD",
            status: "CONFIRMED",
            createdAt: FieldValue.serverTimestamp()
        };

        await db.collection("orders").doc(firestoreOrderId).set(orderDoc);

        // Clear user cart in Firestore if authenticated
        if (request.auth && request.auth.uid) {
            try {
                const cartSnap = await db.collection("users").doc(request.auth.uid).collection("cart").get();
                if (!cartSnap.empty) {
                    const batch = db.batch();
                    cartSnap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
                    await batch.commit();
                }
            } catch (cartErr) {
                console.warn("Could not clear user cart on COD order:", cartErr.message);
            }
        }

        return {
            success: true,
            firestoreOrderId: firestoreOrderId,
            pricing: pricing,
            grandTotalInr: pricing.grandTotalInr,
            codAdvanceInr: pricing.codAdvanceInr,
            codBalanceInr: pricing.codBalanceInr,
            balanceDueOnDeliveryInr: pricing.balanceDueOnDeliveryInr
        };
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. HTTP WEBHOOK: razorpayWebhook
// ─────────────────────────────────────────────────────────────────────────────
exports.razorpayWebhook = onRequest(
    { secrets: [razorpayWebhookSecret] },
    async (req, res) => {
        if (req.method !== "POST") {
            return res.status(405).send("Method Not Allowed");
        }

        const signature = req.headers["x-razorpay-signature"];
        const webhookSecret = razorpayWebhookSecret.value() || process.env.RAZORPAY_WEBHOOK_SECRET;

        if (!signature || !webhookSecret) {
            console.error("Webhook signature or secret missing");
            return res.status(400).send("Webhook signature missing or unconfigured.");
        }

        const rawBody = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
        const expectedSignature = crypto
            .createHmac("sha256", webhookSecret)
            .update(rawBody)
            .digest("hex");

        if (signature !== expectedSignature) {
            console.error("Webhook signature verification failed");
            return res.status(400).send("Invalid webhook signature.");
        }

        const event = req.body.event;
        const payload = req.body.payload || {};

        console.log(`Razorpay Webhook received event: ${event}`);

        // Handle payment.captured and order.paid idempotently
        if (event === "payment.captured" || event === "order.paid") {
            const paymentEntity = (payload.payment && payload.payment.entity) || {};
            const orderEntity = (payload.order && payload.order.entity) || {};

            const rzpOrderId = paymentEntity.order_id || orderEntity.id;
            const rzpPaymentId = paymentEntity.id;
            const receipt = orderEntity.receipt || (paymentEntity.notes && paymentEntity.notes.firestoreOrderId);

            if (rzpOrderId || receipt) {
                try {
                    let orderSnap;
                    if (receipt) {
                        orderSnap = await db.collection("orders").doc(receipt).get();
                    }
                    if (!orderSnap || !orderSnap.exists) {
                        const querySnap = await db.collection("orders")
                            .where("razorpayOrderId", "==", rzpOrderId)
                            .limit(1)
                            .get();
                        if (!querySnap.empty) {
                            orderSnap = querySnap.docs[0];
                        }
                    }

                    if (orderSnap && orderSnap.exists) {
                        const currentData = orderSnap.data();
                        const isPartialCod = currentData.paymentMethod === "PARTIAL_COD" || currentData.paymentMode === "PARTIAL_COD";
                        const targetStatus = isPartialCod ? "PARTIAL_PAID" : "PAID";
                        if (currentData.paymentStatus !== targetStatus && currentData.paymentStatus !== "PAID" && currentData.paymentStatus !== "COLLECTED") {
                            await orderSnap.ref.update({
                                status: "CONFIRMED",
                                paymentStatus: targetStatus,
                                razorpayPaymentId: rzpPaymentId || currentData.razorpayPaymentId || "webhook-confirmed",
                                webhookConfirmedAt: FieldValue.serverTimestamp()
                            });
                            console.log(`Order ${orderSnap.id} confirmed via webhook with paymentStatus ${targetStatus}.`);
                        }
                        // Lock 1-of-1 stock idempotently
                        await lockArtClusiveStockForOrder(orderSnap.ref, currentData);
                    }
                } catch (updateErr) {
                    console.error("Error updating order via webhook:", updateErr);
                }
            }
        }

        return res.status(200).json({ status: "ok" });
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. REST API Endpoints: /api/payments/...
// ─────────────────────────────────────────────────────────────────────────────
exports.api = onRequest(
    { secrets: [razorpayKeySecret, razorpayWebhookSecret], cors: true },
    async (req, res) => {
        const path = req.path || "";

        // POST /api/payments/create-order
        if (path === "/api/payments/create-order" || path === "/create-order") {
            if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
            try {
                const { items, shippingAddress, promoCode, paymentMode } = req.body;
                if (!Array.isArray(items) || items.length === 0) {
                    return res.status(400).json({ error: "Cart items are required" });
                }

                let subtotal = 0;
                const verifiedItems = [];
                for (const item of items) {
                    const pid = item.productId || item.id;
                    const qty = Math.max(1, Math.min(10, Number(item.quantity || 1)));
                    const product = await getAuthoritativeProduct(pid);
                    if (!product) return res.status(404).json({ error: `Product ${pid} not found` });
                    const itemTotal = product.priceInr * qty;
                    subtotal += itemTotal;
                    verifiedItems.push({
                        productId: pid,
                        title: product.title,
                        quantity: qty,
                        unitPriceInr: product.priceInr,
                        totalInr: itemTotal
                    });
                }

                const pricing = calculateOrderPricing(subtotal, promoCode);
                const mode = paymentMode === "PARTIAL_COD" ? "PARTIAL_COD" : "FULL_ONLINE";
                const isPartialCod = mode === "PARTIAL_COD";
                const chargeAmountInPaise = isPartialCod ? (pricing.codAdvanceInr * 100) : pricing.amountInPaise;

                const firestoreOrderId = `ART-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
                const razorpay = getRazorpayClient();
                const rzpOrder = await razorpay.orders.create({
                    amount: chargeAmountInPaise,
                    currency: "INR",
                    receipt: firestoreOrderId,
                    notes: {
                        paymentMode: mode,
                        firestoreOrderId: firestoreOrderId
                    }
                });

                await db.collection("orders").doc(firestoreOrderId).set({
                    orderId: firestoreOrderId,
                    razorpayOrderId: rzpOrder.id,
                    items: verifiedItems,
                    pricing: pricing,
                    shippingAddress: shippingAddress || {},
                    status: "PENDING",
                    paymentStatus: isPartialCod ? "PENDING_ADVANCE" : "PENDING",
                    paymentMethod: isPartialCod ? "PARTIAL_COD" : "RAZORPAY",
                    paymentMode: mode,
                    advancePaidInr: isPartialCod ? pricing.codAdvanceInr : pricing.grandTotalInr,
                    balanceDueOnDeliveryInr: isPartialCod ? pricing.codBalanceInr : 0,
                    createdAt: FieldValue.serverTimestamp()
                });

                return res.status(200).json({
                    orderId: rzpOrder.id,
                    amount: rzpOrder.amount,
                    currency: "INR",
                    firestoreOrderId,
                    grandTotalInr: pricing.grandTotalInr,
                    codAdvanceInr: pricing.codAdvanceInr,
                    codBalanceInr: pricing.codBalanceInr,
                    balanceDueOnDeliveryInr: pricing.codBalanceInr,
                    paymentMode: mode,
                    pricing: pricing
                });
            } catch (err) {
                console.error("API create-order error:", err);
                return res.status(500).json({ error: err.message });
            }
        }

        // POST /api/payments/verify
        if (path === "/api/payments/verify" || path === "/verify") {
            if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
            try {
                const { razorpay_order_id, razorpay_payment_id, razorpay_signature, firestoreOrderId } = req.body;
                const keySecret = razorpayKeySecret.value() || process.env.RAZORPAY_KEY_SECRET;
                const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
                const expectedSignature = crypto
                    .createHmac("sha256", keySecret)
                    .update(payload)
                    .digest("hex");

                if (expectedSignature !== razorpay_signature) {
                    return res.status(400).json({ error: "Invalid payment signature" });
                }

                if (firestoreOrderId) {
                    const orderRef = db.collection("orders").doc(firestoreOrderId);
                    const orderSnap = await orderRef.get();
                    const currentData = orderSnap.exists ? orderSnap.data() : {};
                    const isPartialCod = currentData.paymentMethod === "PARTIAL_COD" || currentData.paymentMode === "PARTIAL_COD";
                    await orderRef.update({
                        status: "CONFIRMED",
                        paymentStatus: isPartialCod ? "PARTIAL_PAID" : "PAID",
                        razorpayPaymentId: razorpay_payment_id,
                        paidAt: FieldValue.serverTimestamp()
                    });
                    await lockArtClusiveStockForOrder(orderRef, currentData);
                }

                return res.status(200).json({ success: true, message: "Payment verified successfully" });
            } catch (err) {
                console.error("API verify error:", err);
                return res.status(500).json({ error: err.message });
            }
        }

        // Delegate webhook if sent to /api/payments/webhook
        if (path === "/api/payments/webhook" || path === "/webhook") {
            return exports.razorpayWebhook(req, res);
        }

        return res.status(404).json({ error: "Endpoint not found" });
    }
);
