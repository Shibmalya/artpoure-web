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

// Authorized Admin Emails (must match firestore.rules and storage.rules)
const ADMIN_EMAILS = [
    "artpoure@gmail.com",
    "artpoure.official@gmail.com",
    "admin@artpoure.in",
    "shibmalyaananya@gmail.com",
    "shibmalyada@gmail.com",
    "deyananya98@gmail.com"
];

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
 * Collision-proof Order ID generation combining current year, base-36 timestamp,
 * and high-entropy cryptographic randomness (e.g., ART-2026-L5K8J9-8F2B).
 */
function generateCollisionFreeOrderId() {
    return `ART-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

/**
 * Helper to release reservations acquired during order creation if the transaction fails midway.
 */
async function rollbackAcquiredReservations(acquiredList, userId) {
    if (!Array.isArray(acquiredList) || acquiredList.length === 0 || !userId) return;
    for (const item of acquiredList) {
        try {
            const pRef = db.collection("products").doc(item.productId);
            await db.runTransaction(async (tx) => {
                const snap = await tx.get(pRef);
                if (!snap.exists) return;
                const data = snap.data() || {};
                const variants = Array.isArray(data.variants) ? [...data.variants] : [];
                const now = Date.now();
                if (variants.length > 0) {
                    let idx = -1;
                    if (item.variantId) {
                        idx = variants.findIndex(v => v && v.id === item.variantId);
                    }
                    if (idx === -1) idx = 0;
                    if (variants[idx]) {
                        const v = variants[idx];
                        const updatedRes = (v.reservations || []).filter(r => r && r.userId !== userId && r.expiresAt > now);
                        const updatedV = { ...v, reservations: updatedRes };
                        if (item.isCustom && updatedV.reservedBy === userId) {
                            delete updatedV.reservedUntil;
                            delete updatedV.reservedBy;
                        }
                        variants[idx] = updatedV;
                        tx.update(pRef, { variants: variants, updatedAt: FieldValue.serverTimestamp() });
                    }
                } else {
                    const updatedRes = (data.reservations || []).filter(r => r && r.userId !== userId && r.expiresAt > now);
                    const updateData = { reservations: updatedRes, updatedAt: FieldValue.serverTimestamp() };
                    if (item.isCustom && data.reservedBy === userId) {
                        updateData.reservedUntil = FieldValue.delete();
                        updateData.reservedBy = FieldValue.delete();
                    }
                    tx.update(pRef, updateData);
                }
            });
        } catch (e) {
            console.warn(`Rollback reservation warning for product ${item.productId}:`, e.message);
        }
    }
}

/**
 * Atomically locks stock and decrements inventory upon payment confirmation
 * using Firestore transactions to prevent simultaneous checkout race conditions.
 * - For 1-of-1 ArtClusive / CUSTOM pieces: marks inStock: false and stockCount: 0.
 * - For catalog products: decrements stockCount by ordered quantity and marks inStock: false if stock reaches 0.
 * Prevents double-execution between verifyRazorpayPayment, razorpayWebhook, and COD confirmation.
 */
async function lockArtClusiveStockForOrder(orderRef, orderData) {
    if (!orderRef) return;
    if (orderData && orderData.stockLocked === true) {
        return;
    }

    try {
        await db.runTransaction(async (tx) => {
            const orderSnap = await tx.get(orderRef);
            if (!orderSnap.exists) return;
            const currentOrder = orderSnap.data() || {};
            if (currentOrder.stockLocked === true) {
                return; // Already locked idempotently
            }

            const items = currentOrder.items || (orderData && orderData.items) || [];
            if (!Array.isArray(items) || items.length === 0) {
                tx.update(orderRef, {
                    stockLocked: true,
                    stockLockedAt: FieldValue.serverTimestamp()
                });
                return;
            }

            // In Firestore transactions, all reads must occur before any writes
            const productEntries = [];
            for (const item of items) {
                const pid = item.productId || item.id;
                if (!pid) continue;
                const pRef = db.collection("products").doc(pid);
                const pSnap = await tx.get(pRef);
                productEntries.push({
                    ref: pRef,
                    snap: pSnap,
                    item: item
                });
            }

            let hasConflict = false;
            let conflictItemTitle = "";
            const productsToUpdate = [];

            for (const entry of productEntries) {
                if (!entry.snap.exists) continue;
                const pData = entry.snap.data() || {};
                const rawCategory = (pData.category || "").toString().trim().toUpperCase();
                const fullName = (pData.fullName || pData.editorialTitle || pData.title || "").toString();

                const isArtClusive = rawCategory === "CUSTOM" ||
                    rawCategory.includes("HAND") ||
                    fullName.toLowerCase().includes("hand-paint") ||
                    fullName.toLowerCase().includes("hand-print");

                const item = entry.item;
                const qty = Math.max(1, Number(item.quantity || 1));
                const variants = Array.isArray(pData.variants) ? [...pData.variants] : [];

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
                        const targetVariant = variants[matchedIdx];
                        const currentStock = typeof targetVariant.stockCount === "number"
                            ? targetVariant.stockCount
                            : (targetVariant.inStock === false ? 0 : 1);

                        if (isArtClusive) {
                            // If already claimed by another order and this order was not already stockLocked
                            if (targetVariant.inStock === false && currentOrder.stockLocked !== true) {
                                hasConflict = true;
                                conflictItemTitle = `${pData.title || item.title || entry.ref.id} (${targetVariant.colorName || 'Default'})`;
                                break;
                            }

                            const updatedVariant = { ...targetVariant, inStock: false, stockCount: 0 };
                            delete updatedVariant.reservedUntil;
                            delete updatedVariant.reservedBy;
                            if (Array.isArray(updatedVariant.reservations)) {
                                updatedVariant.reservations = updatedVariant.reservations.filter(r => r && r.userId !== currentOrder.userId);
                            }
                            variants[matchedIdx] = updatedVariant;
                        } else {
                            // Catalog piece: atomically decrement stockCount
                            if (currentStock < qty && currentOrder.stockLocked !== true) {
                                hasConflict = true;
                                conflictItemTitle = `${pData.title || item.title || entry.ref.id} (${targetVariant.colorName || 'Default'})`;
                                break;
                            }

                            const newStock = Math.max(0, currentStock - qty);
                            const updatedVariant = {
                                ...targetVariant,
                                stockCount: newStock,
                                inStock: newStock > 0
                            };
                            if (Array.isArray(updatedVariant.reservations)) {
                                updatedVariant.reservations = updatedVariant.reservations.filter(r => r && r.userId !== currentOrder.userId);
                            }
                            variants[matchedIdx] = updatedVariant;
                        }

                        // Sync product-level inStock with variant availability
                        const anyVariantInStock = variants.some(v => v && v.inStock === true && (typeof v.stockCount !== "number" || v.stockCount > 0));

                        productsToUpdate.push({
                            ref: entry.ref,
                            data: {
                                variants: variants,
                                inStock: anyVariantInStock,
                                updatedAt: FieldValue.serverTimestamp()
                            }
                        });
                    }
                } else {
                    const currentStock = typeof pData.stockCount === "number"
                        ? pData.stockCount
                        : (pData.inStock === false ? 0 : 1);

                    if (isArtClusive) {
                        if (pData.inStock === false && currentOrder.stockLocked !== true) {
                            hasConflict = true;
                            conflictItemTitle = pData.title || item.title || entry.ref.id;
                            break;
                        }

                        productsToUpdate.push({
                            ref: entry.ref,
                            data: {
                                inStock: false,
                                stockCount: 0,
                                reservedUntil: FieldValue.delete(),
                                reservedBy: FieldValue.delete(),
                                updatedAt: FieldValue.serverTimestamp()
                            }
                        });
                    } else {
                        if (currentStock < qty && currentOrder.stockLocked !== true) {
                            hasConflict = true;
                            conflictItemTitle = pData.title || item.title || entry.ref.id;
                            break;
                        }

                        const newStock = Math.max(0, currentStock - qty);
                        productsToUpdate.push({
                            ref: entry.ref,
                            data: {
                                stockCount: newStock,
                                inStock: newStock > 0,
                                updatedAt: FieldValue.serverTimestamp()
                            }
                        });
                    }
                }
            }

            if (hasConflict) {
                console.warn(`[STOCK CONFLICT] Order ${orderRef.id} conflict on ${conflictItemTitle}. Setting CONFLICT_REFUND_REQUIRED.`);
                tx.update(orderRef, {
                    status: "CONFLICT_REFUND_REQUIRED",
                    stockConflict: true,
                    conflictReason: `Artisanal piece '${conflictItemTitle}' is no longer available in the requested quantity. Immediate refund or review required.`,
                    conflictAt: FieldValue.serverTimestamp()
                });
                return;
            }

            // Apply all product stock updates
            for (const pUpdate of productsToUpdate) {
                tx.update(pUpdate.ref, pUpdate.data);
            }

            // Set stockLocked: true on the order document
            tx.update(orderRef, {
                stockLocked: true,
                stockLockedAt: FieldValue.serverTimestamp()
            });
            console.log(`[STOCK LOCKED] Order ${orderRef.id} successfully locked inventory.`);
        });
    } catch (err) {
        console.error(`Error in lockArtClusiveStockForOrder transaction for order ${orderRef.id}:`, err);
        throw err;
    }
}

/**
 * Releases stock reservation for non-CUSTOM products upon payment cancellation or failure.
 * STRICT POLICY: CUSTOM (ArtClusive 1-of-1) pieces maintain their 10-minute hold even on failure/cancellation.
 * All other catalog products have their reservation immediately removed.
 */
async function releaseReservationForOrder(orderRef, orderData, reason = "payment_cancelled") {
    if (!orderRef || !orderData) return;

    // Do not release if order was already confirmed or stock was finalized
    if (orderData.status === "CONFIRMED" || orderData.stockLocked === true) {
        return;
    }

    const items = orderData.items || [];
    const userId = orderData.userId;
    if (!Array.isArray(items) || items.length === 0 || !userId) {
        return;
    }

    try {
        await db.runTransaction(async (tx) => {
            const orderSnap = await tx.get(orderRef);
            if (!orderSnap.exists) return;
            const currentOrder = orderSnap.data() || {};
            if (currentOrder.status === "CONFIRMED" || currentOrder.stockLocked === true) {
                return;
            }

            // In Firestore transactions, all reads must occur before writes
            const productEntries = [];
            for (const item of items) {
                const pid = item.productId || item.id;
                if (!pid) continue;
                const pRef = db.collection("products").doc(pid);
                const pSnap = await tx.get(pRef);
                productEntries.push({
                    ref: pRef,
                    snap: pSnap,
                    item: item
                });
            }

            const now = Date.now();
            const productsToUpdate = [];

            for (const entry of productEntries) {
                if (!entry.snap.exists) continue;
                const pData = entry.snap.data() || {};
                const rawCategory = (pData.category || "").toString().trim().toUpperCase();

                // STRICT RULE: If product.category is "CUSTOM" (case-insensitive), DO NOT RELEASE early!
                // Leave reservedUntil / reservations intact so it expires naturally after 10 minutes.
                if (rawCategory === "CUSTOM") {
                    console.log(`[RESERVATION PRESERVED] 1-of-1 CUSTOM piece ${entry.ref.id} retains 10-minute hold.`);
                    continue;
                }

                // For all other categories: immediately remove orderData.userId's entry from variant.reservations
                // and prune any expired reservations (expiresAt <= now)
                const item = entry.item;
                const variants = Array.isArray(pData.variants) ? [...pData.variants] : [];

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
                        const targetVariant = variants[matchedIdx];
                        const currentRes = Array.isArray(targetVariant.reservations) ? targetVariant.reservations : [];
                        const cleanedRes = currentRes.filter(r => r && r.userId !== userId && r.expiresAt > now);

                        variants[matchedIdx] = {
                            ...targetVariant,
                            reservations: cleanedRes
                        };

                        productsToUpdate.push({
                            ref: entry.ref,
                            data: {
                                variants: variants,
                                updatedAt: FieldValue.serverTimestamp()
                            }
                        });
                    }
                } else {
                    const currentRes = Array.isArray(pData.reservations) ? pData.reservations : [];
                    const cleanedRes = currentRes.filter(r => r && r.userId !== userId && r.expiresAt > now);

                    productsToUpdate.push({
                        ref: entry.ref,
                        data: {
                            reservations: cleanedRes,
                            updatedAt: FieldValue.serverTimestamp()
                        }
                    });
                }
            }

            // Apply product updates
            for (const pUpdate of productsToUpdate) {
                tx.update(pUpdate.ref, pUpdate.data);
            }

            // Update order status
            tx.update(orderRef, {
                status: "PAYMENT_CANCELLED",
                paymentStatus: "CANCELLED",
                cancelledReason: reason,
                reservationReleasedAt: FieldValue.serverTimestamp()
            });

            console.log(`[RESERVATION RELEASED] Released non-custom reservations for order ${orderRef.id} (reason: ${reason}).`);
        });
    } catch (err) {
        console.error(`Error in releaseReservationForOrder for ${orderRef.id}:`, err);
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

        const uid = request.auth.uid;

        // One-time use guard for FIRST10 promo code per user (requires zero composite indexes)
        if (promoCode === "FIRST10" && uid) {
            const userOrdersSnap = await db.collection("orders")
                .where("userId", "==", uid)
                .get();

            const hasUsedFirst10 = userOrdersSnap.docs.some(doc => {
                const d = doc.data() || {};
                const st = (d.status || "").toUpperCase();
                const isConfirmedOrder = st === "CONFIRMED" || st === "PACKED" || st === "SHIPPED" || st === "DELIVERED";
                return isConfirmedOrder && d.pricing && d.pricing.promoCode === "FIRST10";
            });

            if (hasUsedFirst10) {
                throw new HttpsError(
                    "failed-precondition",
                    "FIRST10 is valid only on your first completed order."
                );
            }
        }

        // Strictly re-calculate subtotal and reserve items inside ONE single atomic transaction
        // (performs all reads first, then all validations, then all writes)
        const { verifiedItems, subtotal } = await db.runTransaction(async (tx) => {
            const now = Date.now();
            const reservationDuration = 10 * 60 * 1000; // 10 minutes

            // 1. Collect all unique product IDs
            const productIds = [...new Set(clientItems.map(it => it.productId || it.id).filter(Boolean))];

            // 2. Perform ALL reads first (tx.get for each unique product)
            const snapEntries = await Promise.all(
                productIds.map(async (pid) => {
                    const ref = db.collection("products").doc(pid);
                    const snap = await tx.get(ref);
                    return { pid, ref, snap };
                })
            );

            // Build in-memory working copy for each product
            const productMap = new Map();
            for (const { pid, ref, snap } of snapEntries) {
                if (snap.exists) {
                    const data = snap.data() || {};
                    productMap.set(pid, {
                        ref,
                        exists: true,
                        data: { ...data },
                        variants: Array.isArray(data.variants) ? data.variants.map(v => ({ ...v })) : [],
                        isModified: false
                    });
                } else if (SERVER_CATALOG_PRICING[pid]) {
                    const fallback = SERVER_CATALOG_PRICING[pid];
                    productMap.set(pid, {
                        ref,
                        exists: false,
                        data: {
                            priceInr: fallback.priceInr,
                            title: fallback.title,
                            category: "SAREES",
                            inStock: true
                        },
                        variants: [],
                        isModified: false
                    });
                } else {
                    productMap.set(pid, null);
                }
            }

            // 3. Perform all validations & reservation updates in-memory
            let calculatedSubtotal = 0;
            const verified = [];

            for (const item of clientItems) {
                const pid = item.productId || item.id;
                const qty = Math.max(1, Math.min(10, Number(item.quantity || 1)));
                const prodEntry = productMap.get(pid);

                if (!prodEntry || !prodEntry.data || Number(prodEntry.data.priceInr || prodEntry.data.price || 0) <= 0) {
                    throw new HttpsError(
                        "not-found",
                        `Artisanal piece with ID '${pid}' could not be verified in store catalog.`
                    );
                }

                const pData = prodEntry.data;
                const pVariants = prodEntry.variants;
                const productTitle = pData.editorialTitle || pData.fullName || pData.title || pid;
                const rawCategory = (pData.category || "").toString().trim().toUpperCase();
                const targetVariantId = item.variantId || item.selectedVariantId;
                const targetColorName = (item.variant || item.colorName || "").toString().trim().toLowerCase();

                let matchedVariant = null;
                let matchedIdx = -1;
                if (pVariants.length > 0) {
                    if (targetVariantId) {
                        matchedIdx = pVariants.findIndex(v => v && v.id === targetVariantId);
                    }
                    if (matchedIdx === -1 && targetColorName && targetColorName !== "standard") {
                        matchedIdx = pVariants.findIndex(v => v && (v.colorName || "").toString().trim().toLowerCase() === targetColorName);
                    }
                    if (matchedIdx === -1) {
                        matchedIdx = 0;
                    }
                    matchedVariant = pVariants[matchedIdx];
                }

                if (matchedVariant && (matchedVariant.inStock === false || (typeof matchedVariant.stockCount === "number" && matchedVariant.stockCount <= 0))) {
                    throw new HttpsError(
                        "failed-precondition",
                        `"${productTitle}" is currently out of stock.`
                    );
                }
                if (pData.inStock === false) {
                    throw new HttpsError(
                        "failed-precondition",
                        `"${productTitle}" is currently out of stock.`
                    );
                }

                if (rawCategory === "CUSTOM") {
                    if (matchedVariant) {
                        const isReservedByOther = (
                            matchedVariant.reservedUntil &&
                            matchedVariant.reservedUntil > now &&
                            matchedVariant.reservedBy &&
                            matchedVariant.reservedBy !== uid
                        ) || (
                            Array.isArray(matchedVariant.reservations) &&
                            matchedVariant.reservations.some(r => r && r.expiresAt > now && r.userId !== uid)
                        );

                        if (isReservedByOther) {
                            throw new HttpsError(
                                "failed-precondition",
                                "This 1-of-1 ArtClusive piece is currently in another client's checkout. Please check back in 10 minutes."
                            );
                        }

                        const activeReservations = (matchedVariant.reservations || []).filter(r => r && r.expiresAt > now && r.userId !== uid);
                        activeReservations.push({ userId: uid, expiresAt: now + reservationDuration, quantity: qty });

                        pVariants[matchedIdx] = {
                            ...matchedVariant,
                            reservedUntil: now + reservationDuration,
                            reservedBy: uid,
                            reservations: activeReservations
                        };
                        prodEntry.isModified = true;
                    } else {
                        const isReservedByOther = (
                            pData.reservedUntil &&
                            pData.reservedUntil > now &&
                            pData.reservedBy &&
                            pData.reservedBy !== uid
                        ) || (
                            Array.isArray(pData.reservations) &&
                            pData.reservations.some(r => r && r.expiresAt > now && r.userId !== uid)
                        );

                        if (isReservedByOther) {
                            throw new HttpsError(
                                "failed-precondition",
                                "This 1-of-1 ArtClusive piece is currently in another client's checkout. Please check back in 10 minutes."
                            );
                        }

                        const activeReservations = (pData.reservations || []).filter(r => r && r.expiresAt > now && r.userId !== uid);
                        activeReservations.push({ userId: uid, expiresAt: now + reservationDuration, quantity: qty });

                        pData.reservedUntil = now + reservationDuration;
                        pData.reservedBy = uid;
                        pData.reservations = activeReservations;
                        prodEntry.isModified = true;
                    }
                } else {
                    // Non-CUSTOM products: check available capacity against active reservations
                    if (matchedVariant) {
                        const stockCount = typeof matchedVariant.stockCount === "number"
                            ? matchedVariant.stockCount
                            : (matchedVariant.inStock === false ? 0 : 1);

                        if (stockCount <= 0 || matchedVariant.inStock === false) {
                            throw new HttpsError("failed-precondition", `"${productTitle}" is currently out of stock.`);
                        }

                        const currentReservations = (matchedVariant.reservations || []).filter(r => r && r.expiresAt > now && r.userId !== uid);
                        const activeReservedQty = currentReservations.reduce((sum, r) => sum + (Number(r.quantity) || 1), 0);
                        const availableCapacity = stockCount - activeReservedQty;

                        if (availableCapacity <= 0) {
                            throw new HttpsError(
                                "failed-precondition",
                                `All available units of "${productTitle}" are currently in checkout. Please try again in a few minutes.`
                            );
                        }
                        if (qty > availableCapacity) {
                            throw new HttpsError(
                                "failed-precondition",
                                `Only ${availableCapacity} unit(s) available for "${productTitle}". Please adjust your cart.`
                            );
                        }

                        currentReservations.push({
                            userId: uid,
                            expiresAt: now + reservationDuration,
                            quantity: qty
                        });

                        pVariants[matchedIdx] = {
                            ...matchedVariant,
                            reservations: currentReservations
                        };
                        prodEntry.isModified = true;
                    } else {
                        const stockCount = typeof pData.stockCount === "number"
                            ? pData.stockCount
                            : (pData.inStock === false ? 0 : 1);

                        if (stockCount <= 0 || pData.inStock === false) {
                            throw new HttpsError("failed-precondition", `"${productTitle}" is currently out of stock.`);
                        }

                        const currentReservations = (pData.reservations || []).filter(r => r && r.expiresAt > now && r.userId !== uid);
                        const activeReservedQty = currentReservations.reduce((sum, r) => sum + (Number(r.quantity) || 1), 0);
                        const availableCapacity = stockCount - activeReservedQty;

                        if (availableCapacity <= 0) {
                            throw new HttpsError(
                                "failed-precondition",
                                `All available units of "${productTitle}" are currently in checkout. Please try again in a few minutes.`
                            );
                        }
                        if (qty > availableCapacity) {
                            throw new HttpsError(
                                "failed-precondition",
                                `Only ${availableCapacity} unit(s) available for "${productTitle}". Please adjust your cart.`
                            );
                        }

                        currentReservations.push({
                            userId: uid,
                            expiresAt: now + reservationDuration,
                            quantity: qty
                        });

                        pData.reservations = currentReservations;
                        prodEntry.isModified = true;
                    }
                }

                const unitPrice = Number(pData.priceInr || pData.price || 0);
                const itemTotal = unitPrice * qty;
                calculatedSubtotal += itemTotal;

                verified.push({
                    productId: pid,
                    variantId: targetVariantId || (matchedVariant ? matchedVariant.id : ""),
                    title: productTitle,
                    variant: (matchedVariant && matchedVariant.colorName) || item.variant || item.colorName || "Standard",
                    quantity: qty,
                    unitPriceInr: unitPrice,
                    totalInr: itemTotal
                });
            }

            // 4. Perform ALL writes at the end of the transaction
            for (const prodEntry of productMap.values()) {
                if (prodEntry && prodEntry.exists && prodEntry.isModified) {
                    if (prodEntry.variants.length > 0) {
                        tx.update(prodEntry.ref, {
                            variants: prodEntry.variants,
                            updatedAt: FieldValue.serverTimestamp()
                        });
                    } else {
                        const updatePayload = {
                            reservations: prodEntry.data.reservations || [],
                            updatedAt: FieldValue.serverTimestamp()
                        };
                        if (prodEntry.data.reservedUntil) updatePayload.reservedUntil = prodEntry.data.reservedUntil;
                        if (prodEntry.data.reservedBy) updatePayload.reservedBy = prodEntry.data.reservedBy;
                        tx.update(prodEntry.ref, updatePayload);
                    }
                }
            }

            return { verifiedItems: verified, subtotal: calculatedSubtotal };
        });

        // Compute discount, shipping, and grand total via centralized pricing helper
        const pricing = calculateOrderPricing(subtotal, promoCode);
        const paymentMode = data.paymentMode === "PARTIAL_COD" ? "PARTIAL_COD" : "FULL_ONLINE";
        const isPartialCod = paymentMode === "PARTIAL_COD";
        const chargeAmountInPaise = isPartialCod ? (pricing.codAdvanceInr * 100) : pricing.amountInPaise;

        const firestoreOrderId = generateCollisionFreeOrderId();

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

        const uid = request.auth ? request.auth.uid : null;

        // One-time use guard for FIRST10 promo code per user (requires zero composite indexes)
        if (promoCode === "FIRST10" && uid) {
            const userOrdersSnap = await db.collection("orders")
                .where("userId", "==", uid)
                .get();

            const hasUsedFirst10 = userOrdersSnap.docs.some(doc => {
                const d = doc.data() || {};
                const st = (d.status || "").toUpperCase();
                const isConfirmedOrder = st === "CONFIRMED" || st === "PACKED" || st === "SHIPPED" || st === "DELIVERED";
                return isConfirmedOrder && d.pricing && d.pricing.promoCode === "FIRST10";
            });

            if (hasUsedFirst10) {
                throw new HttpsError(
                    "failed-precondition",
                    "FIRST10 is valid only on your first completed order."
                );
            }
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

            const targetVariantId = item.variantId || item.selectedVariantId;
            const targetColorName = (item.variant || item.colorName || "").toString().trim().toLowerCase();
            const rawCategory = (product.category || "").toString().trim().toUpperCase();

            // Check reservation and stock for CUSTOM pieces
            if (rawCategory === "CUSTOM") {
                const productRef = db.collection("products").doc(pid);
                await db.runTransaction(async (tx) => {
                    const pSnap = await tx.get(productRef);
                    if (!pSnap.exists) return;
                    const pData = pSnap.data() || {};
                    const pVariants = Array.isArray(pData.variants) ? pData.variants : [];
                    const now = Date.now();

                    let matchedVariant = null;
                    if (targetVariantId) {
                        matchedVariant = pVariants.find(v => v && v.id === targetVariantId);
                    }
                    if (!matchedVariant && targetColorName && targetColorName !== "standard") {
                        matchedVariant = pVariants.find(v => v && (v.colorName || "").toString().trim().toLowerCase() === targetColorName);
                    }
                    if (!matchedVariant && pVariants.length > 0) {
                        matchedVariant = pVariants[0];
                    }

                    if ((matchedVariant && matchedVariant.inStock === false) || pData.inStock === false) {
                        throw new HttpsError(
                            "failed-precondition",
                            "This 1-of-1 piece has already been claimed."
                        );
                    }

                    const isReservedByOther = (
                        matchedVariant &&
                        matchedVariant.reservedUntil &&
                        matchedVariant.reservedUntil > now &&
                        matchedVariant.reservedBy &&
                        matchedVariant.reservedBy !== uid
                    ) || (
                        matchedVariant &&
                        Array.isArray(matchedVariant.reservations) &&
                        matchedVariant.reservations.some(r => r && r.expiresAt > now && r.userId !== uid)
                    ) || (
                        pData.reservedUntil &&
                        pData.reservedUntil > now &&
                        pData.reservedBy &&
                        pData.reservedBy !== uid
                    ) || (
                        Array.isArray(pData.reservations) &&
                        pData.reservations.some(r => r && r.expiresAt > now && r.userId !== uid)
                    );

                    if (isReservedByOther) {
                        throw new HttpsError(
                            "failed-precondition",
                            "This 1-of-1 ArtClusive piece is currently in another client's checkout. Please check back in 10 minutes."
                        );
                    }
                });
            } else {
                // For non-CUSTOM catalog items, verify available stock and capacity inside transaction
                const productRef = db.collection("products").doc(pid);
                await db.runTransaction(async (tx) => {
                    const pSnap = await tx.get(productRef);
                    if (!pSnap.exists) return;
                    const pData = pSnap.data() || {};
                    const pVariants = Array.isArray(pData.variants) ? pData.variants : [];
                    const now = Date.now();

                    let matchedVariant = null;
                    if (targetVariantId) {
                        matchedVariant = pVariants.find(v => v && v.id === targetVariantId);
                    }
                    if (!matchedVariant && targetColorName && targetColorName !== "standard") {
                        matchedVariant = pVariants.find(v => v && (v.colorName || "").toString().trim().toLowerCase() === targetColorName);
                    }
                    if (!matchedVariant && pVariants.length > 0) {
                        matchedVariant = pVariants[0];
                    }

                    const selectedVariant = matchedVariant;
                    const stockCount = selectedVariant
                        ? (typeof selectedVariant.stockCount === "number" ? selectedVariant.stockCount : (selectedVariant.inStock === false ? 0 : 1))
                        : (typeof pData.stockCount === "number" ? pData.stockCount : (pData.inStock === false ? 0 : 1));

                    if (stockCount <= 0 || (selectedVariant && selectedVariant.inStock === false) || pData.inStock === false) {
                        throw new HttpsError(
                            "failed-precondition",
                            `"${product.title}" is currently out of stock.`
                        );
                    }

                    const currentReservations = (selectedVariant ? selectedVariant.reservations : pData.reservations) || [];
                    const activeReservations = currentReservations.filter(r => r && r.expiresAt > now && r.userId !== uid);
                    const activeReservedQty = activeReservations.reduce((sum, r) => sum + (Number(r.quantity) || 1), 0);
                    const availableCapacity = stockCount - activeReservedQty;

                    if (availableCapacity <= 0) {
                        throw new HttpsError(
                            "failed-precondition",
                            `All available units of "${product.title}" are currently in checkout. Please try again in a few minutes.`
                        );
                    }
                    if (availableCapacity < qty) {
                        throw new HttpsError(
                            "failed-precondition",
                            `Only ${availableCapacity} unit(s) available for "${product.title}". Please adjust your cart.`
                        );
                    }
                });
            }

            const itemTotal = product.priceInr * qty;
            subtotal += itemTotal;

            verifiedItems.push({
                productId: pid,
                variantId: targetVariantId || "",
                title: product.title,
                variant: item.variant || item.colorName || "Standard",
                quantity: qty,
                unitPriceInr: product.priceInr,
                totalInr: itemTotal
            });
        }

        // Compute discount, shipping, and grand total via centralized pricing helper
        const pricing = calculateOrderPricing(subtotal, promoCode);

        const firestoreOrderId = generateCollisionFreeOrderId();

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

        // Auto-lock stock for 1-of-1 ArtClusive / CUSTOM pieces if present
        await lockArtClusiveStockForOrder(db.collection("orders").doc(firestoreOrderId), orderDoc);

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

        // Handle payment.failed: release reservation for non-CUSTOM items immediately
        if (event === "payment.failed") {
            const paymentEntity = (payload.payment && payload.payment.entity) || {};
            const orderEntity = (payload.order && payload.order.entity) || {};
            const rzpOrderId = paymentEntity.order_id || orderEntity.id;
            const receipt = orderEntity.receipt || (paymentEntity.notes && paymentEntity.notes.firestoreOrderId);
            const failReason = paymentEntity.error_description || "payment_failed";

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
                        const currentData = orderSnap.data() || {};
                        await releaseReservationForOrder(orderSnap.ref, currentData, `webhook: ${failReason}`);
                    }
                } catch (failErr) {
                    console.error("Error releasing reservation on payment.failed webhook:", failErr);
                }
            }
        }

        // Handle refund.processed: sync refund status initiated from Razorpay Dashboard
        if (event === "refund.processed") {
            const refundEntity = (payload.refund && payload.refund.entity) || {};
            const rzpPaymentId = refundEntity.payment_id;
            const rzpRefundId = refundEntity.id;
            const refundAmountInr = Math.round((refundEntity.amount || 0) / 100);

            if (rzpPaymentId) {
                try {
                    const querySnap = await db.collection("orders")
                        .where("razorpayPaymentId", "==", rzpPaymentId)
                        .limit(1)
                        .get();
                    if (!querySnap.empty) {
                        const orderDoc = querySnap.docs[0];
                        const d = orderDoc.data() || {};
                        if (d.paymentStatus !== "REFUNDED") {
                            await orderDoc.ref.update({
                                paymentStatus: "REFUNDED",
                                status: "CANCELLED",
                                razorpayRefundId: rzpRefundId || d.razorpayRefundId || "webhook-refund",
                                refundAmountInr: refundAmountInr || d.refundAmountInr || 0,
                                webhookRefundedAt: FieldValue.serverTimestamp()
                            });
                            console.log(`Order ${orderDoc.id} marked REFUNDED via webhook.`);
                        }
                    }
                } catch (refErr) {
                    console.error("Error processing refund.processed webhook:", refErr);
                }
            }
        }

        return res.status(200).json({ status: "ok" });
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. CALLABLE: releaseOrderReservation
// ─────────────────────────────────────────────────────────────────────────────
exports.releaseOrderReservation = onCall(
    { cors: true },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be securely signed in to release order reservation.");
        }

        const data = request.data || {};
        const firestoreOrderId = data.firestoreOrderId || data.orderId;
        const razorpayOrderId = data.razorpayOrderId;
        const reason = data.reason || "payment_cancelled";

        if (!firestoreOrderId && !razorpayOrderId) {
            throw new HttpsError("invalid-argument", "Missing order identifier.");
        }

        let orderRef = null;
        let orderSnap = null;

        if (firestoreOrderId) {
            orderRef = db.collection("orders").doc(firestoreOrderId);
            orderSnap = await orderRef.get();
        }
        if ((!orderSnap || !orderSnap.exists) && razorpayOrderId) {
            const querySnap = await db.collection("orders")
                .where("razorpayOrderId", "==", razorpayOrderId)
                .limit(1)
                .get();
            if (!querySnap.empty) {
                orderSnap = querySnap.docs[0];
                orderRef = orderSnap.ref;
            }
        }

        if (!orderSnap || !orderSnap.exists) {
            throw new HttpsError("not-found", "Order could not be found.");
        }

        const orderData = orderSnap.data() || {};
        if (orderData.userId && orderData.userId !== request.auth.uid) {
            throw new HttpsError("permission-denied", "Unauthorized: Caller does not match order owner.");
        }

        await releaseReservationForOrder(orderRef, orderData, reason);

        return {
            success: true,
            message: "Non-custom reservation released successfully."
        };
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. CALLABLE: issueOrderRefund (Admin-Only 1-Click Razorpay Refund + Restock)
// ─────────────────────────────────────────────────────────────────────────────
exports.issueOrderRefund = onCall(
    { secrets: [razorpayKeySecret], cors: true },
    async (request) => {
        // Strict Admin Auth Check
        if (
            !request.auth ||
            request.auth.token.email_verified !== true ||
            !request.auth.token.email ||
            !ADMIN_EMAILS.includes(request.auth.token.email.toLowerCase())
        ) {
            throw new HttpsError("permission-denied", "Admin privileges required.");
        }

        const data = request.data || {};
        const orderId = data.orderId;
        const reason = (data.reason || "Admin initiated refund").toString().trim();
        const restockInventory = data.restockInventory !== false;

        if (!orderId) {
            throw new HttpsError("invalid-argument", "Missing order ID.");
        }

        const adminEmail = (request.auth.token.email || "").toLowerCase();
        const orderRef = db.collection("orders").doc(orderId);
        const orderSnap = await orderRef.get();

        if (!orderSnap.exists) {
            throw new HttpsError("not-found", `Order with ID '${orderId}' not found.`);
        }

        const orderData = orderSnap.data() || {};

        if (orderData.paymentStatus === "REFUNDED" || orderData.razorpayRefundId) {
            throw new HttpsError("failed-precondition", "This order has already been refunded.");
        }

        if (!orderData.razorpayPaymentId || !orderData.razorpayPaymentId.startsWith("pay_")) {
            throw new HttpsError("failed-precondition", "No Razorpay payment ID found on this order.");
        }

        // Call Razorpay API to issue refund (omitting amount refunds the entire captured payment)
        const razorpay = getRazorpayClient();
        let refund;
        try {
            refund = await razorpay.payments.refund(orderData.razorpayPaymentId, {
                speed: "normal",
                notes: {
                    orderId: orderId,
                    reason: reason,
                    issuedBy: adminEmail
                }
            });
        } catch (err) {
            console.error("Razorpay refund execution error:", err);
            throw new HttpsError("internal", `Razorpay refund failed: ${err.message || err}`);
        }

        const refundAmountInr = Math.round((refund.amount || 0) / 100);

        // Firestore Order Update + Optional Atomic Restock inside Transaction
        await db.runTransaction(async (tx) => {
            const freshOrderSnap = await tx.get(orderRef);
            if (!freshOrderSnap.exists) {
                throw new HttpsError("not-found", "Order disappeared during transaction.");
            }
            const freshOrderData = freshOrderSnap.data() || {};
            if (freshOrderData.paymentStatus === "REFUNDED" || freshOrderData.razorpayRefundId) {
                throw new HttpsError("failed-precondition", "Order was already marked refunded.");
            }

            const shouldRestock = restockInventory === true &&
                freshOrderData.stockLocked === true &&
                freshOrderData.stockRestocked !== true;

            const items = Array.isArray(freshOrderData.items) ? freshOrderData.items : [];
            const productWorkingMap = new Map();

            // Perform ALL reads first
            if (shouldRestock && items.length > 0) {
                const uniqueProductIds = [...new Set(items.map(it => it.productId || it.id).filter(Boolean))];
                for (const pid of uniqueProductIds) {
                    const pRef = db.collection("products").doc(pid);
                    const pSnap = await tx.get(pRef);
                    if (pSnap.exists) {
                        const pData = pSnap.data() || {};
                        productWorkingMap.set(pid, {
                            ref: pRef,
                            data: pData,
                            variants: Array.isArray(pData.variants) ? pData.variants.map(v => ({ ...v })) : [],
                            stockCount: typeof pData.stockCount === "number" ? pData.stockCount : 0
                        });
                    }
                }
            }

            // In-memory restock calculations
            if (shouldRestock && items.length > 0) {
                for (const item of items) {
                    const pid = item.productId || item.id;
                    const qty = Math.max(1, Number(item.quantity || 1));
                    const pEntry = productWorkingMap.get(pid);
                    if (!pEntry) continue;

                    const targetVariantId = item.variantId || item.selectedVariantId;
                    const targetColorName = (item.variant || item.colorName || "").toString().trim().toLowerCase();

                    if (pEntry.variants.length > 0) {
                        let matchedIdx = -1;
                        if (targetVariantId) {
                            matchedIdx = pEntry.variants.findIndex(v => v && v.id === targetVariantId);
                        }
                        if (matchedIdx === -1 && targetColorName && targetColorName !== "standard") {
                            matchedIdx = pEntry.variants.findIndex(v => v && (v.colorName || "").toString().trim().toLowerCase() === targetColorName);
                        }
                        if (matchedIdx === -1) {
                            matchedIdx = 0;
                        }

                        const v = pEntry.variants[matchedIdx];
                        if (v) {
                            const curStock = typeof v.stockCount === "number" ? v.stockCount : 0;
                            pEntry.variants[matchedIdx] = {
                                ...v,
                                stockCount: curStock + qty,
                                inStock: true
                            };
                        }
                    } else {
                        pEntry.stockCount += qty;
                    }
                }
            }

            // Perform ALL writes
            if (shouldRestock && productWorkingMap.size > 0) {
                for (const pEntry of productWorkingMap.values()) {
                    if (pEntry.variants.length > 0) {
                        const productHasStock = pEntry.variants.some(v => v && v.inStock === true && (typeof v.stockCount !== "number" || v.stockCount > 0));
                        tx.update(pEntry.ref, {
                            variants: pEntry.variants,
                            inStock: productHasStock,
                            updatedAt: FieldValue.serverTimestamp()
                        });
                    } else {
                        tx.update(pEntry.ref, {
                            stockCount: pEntry.stockCount,
                            inStock: pEntry.stockCount > 0,
                            updatedAt: FieldValue.serverTimestamp()
                        });
                    }
                }
            }

            const orderUpdate = {
                paymentStatus: "REFUNDED",
                status: "CANCELLED",
                razorpayRefundId: refund.id,
                refundAmountInr: refundAmountInr,
                refundReason: reason,
                refundedBy: adminEmail,
                refundedAt: FieldValue.serverTimestamp()
            };
            if (shouldRestock) {
                orderUpdate.stockRestocked = true;
            }

            tx.update(orderRef, orderUpdate);
        });

        return {
            success: true,
            refundId: refund.id,
            refundAmountInr: refundAmountInr,
            restocked: Boolean(restockInventory && orderData.stockLocked && !orderData.stockRestocked)
        };
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

                const firestoreOrderId = generateCollisionFreeOrderId();
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
