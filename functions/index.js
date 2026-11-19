const crypto = require("crypto");
const admin = require("firebase-admin");
const Razorpay = require("razorpay");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

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
                title: data.editorialTitle || data.fullName || data.title || productId
            };
        }
    } catch (e) {
        console.warn(`Firestore price lookup for ${productId} warning:`, e.message);
    }

    if (SERVER_CATALOG_PRICING[productId]) {
        return {
            id: productId,
            ...SERVER_CATALOG_PRICING[productId]
        };
    }

    return null;
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

        // Compute discount, shipping, and grand total
        const discount = promoCode === "FIRST10" ? Math.round(subtotal * 0.10) : 0;
        const shipping = (subtotal >= 25000 || subtotal === 0) ? 0 : 500;
        const grandTotalInr = Math.max(0, subtotal - discount + shipping);
        const amountInPaise = Math.round(grandTotalInr * 100);

        const currentYear = new Date().getFullYear();
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const firestoreOrderId = `ART-${currentYear}-${randomNum}`;

        // Create Live Razorpay Order
        const razorpay = getRazorpayClient();
        let rzpOrder;
        try {
            rzpOrder = await razorpay.orders.create({
                amount: amountInPaise,
                currency: "INR",
                receipt: firestoreOrderId,
                notes: {
                    userId: request.auth.uid,
                    firestoreOrderId: firestoreOrderId,
                    promoCode: promoCode || "NONE"
                }
            });
        } catch (err) {
            console.error("Razorpay order creation error:", err);
            throw new HttpsError("internal", `Failed to create live Razorpay order: ${err.message || err}`);
        }

        // Write pending order document into Firestore
        const orderDoc = {
            orderId: firestoreOrderId,
            userId: request.auth.uid,
            razorpayOrderId: rzpOrder.id,
            items: verifiedItems,
            pricing: {
                subtotalInr: subtotal,
                discountInr: discount,
                shippingInr: shipping,
                grandTotalInr: grandTotalInr,
                amountInPaise: amountInPaise,
                promoCode: promoCode || null
            },
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
            paymentStatus: "PENDING",
            paymentMethod: "RAZORPAY",
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection("orders").doc(firestoreOrderId).set(orderDoc);

        return {
            razorpayOrderId: rzpOrder.id,
            amount: rzpOrder.amount,
            currency: "INR",
            firestoreOrderId: firestoreOrderId,
            grandTotalInr: grandTotalInr
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

        // Update Firestore order status to CONFIRMED / PAID
        const orderRef = db.collection("orders").doc(firestoreOrderId);
        await orderRef.update({
            status: "CONFIRMED",
            paymentStatus: "PAID",
            razorpayPaymentId: razorpayPaymentId,
            razorpaySignature: razorpaySignature,
            paidAt: admin.firestore.FieldValue.serverTimestamp()
        });

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
            message: "Payment successfully verified and commission confirmed."
        };
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. HTTP WEBHOOK: razorpayWebhook
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
                        if (currentData.paymentStatus !== "PAID") {
                            await orderSnap.ref.update({
                                status: "CONFIRMED",
                                paymentStatus: "PAID",
                                razorpayPaymentId: rzpPaymentId || currentData.razorpayPaymentId || "webhook-confirmed",
                                webhookConfirmedAt: admin.firestore.FieldValue.serverTimestamp()
                            });
                            console.log(`Order ${orderSnap.id} confirmed via webhook.`);
                        }
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
                const { items, shippingAddress, promoCode } = req.body;
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

                const discount = (promoCode || "").toUpperCase() === "FIRST10" ? Math.round(subtotal * 0.10) : 0;
                const shipping = subtotal >= 25000 ? 0 : 500;
                const grandTotal = Math.max(0, subtotal - discount + shipping);
                const amountInPaise = Math.round(grandTotal * 100);

                const firestoreOrderId = `ART-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
                const razorpay = getRazorpayClient();
                const rzpOrder = await razorpay.orders.create({
                    amount: amountInPaise,
                    currency: "INR",
                    receipt: firestoreOrderId
                });

                await db.collection("orders").doc(firestoreOrderId).set({
                    orderId: firestoreOrderId,
                    razorpayOrderId: rzpOrder.id,
                    items: verifiedItems,
                    pricing: { subtotal, discount, shipping, grandTotal, amountInPaise },
                    shippingAddress: shippingAddress || {},
                    status: "PENDING",
                    paymentStatus: "PENDING",
                    paymentMethod: "RAZORPAY",
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });

                return res.status(200).json({
                    orderId: rzpOrder.id,
                    amount: rzpOrder.amount,
                    currency: "INR",
                    firestoreOrderId
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
                    await db.collection("orders").doc(firestoreOrderId).update({
                        status: "CONFIRMED",
                        paymentStatus: "PAID",
                        razorpayPaymentId: razorpay_payment_id,
                        paidAt: admin.firestore.FieldValue.serverTimestamp()
                    });
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
