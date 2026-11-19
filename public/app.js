/**
 * ARTPOURE • HAUTE ETHNIC EDITORIAL WEB APPLICATION
 * Modular ES6 implementation matching Android Jetpack Compose Architecture
 */

import {
    auth,
    db,
    functions,
    httpsCallable,
    collection,
    getDocs,
    doc,
    setDoc,
    getDoc,
    onAuthStateChanged,
    signInAnonymously
} from './firebase-config.js';

// --- AUTHENTICATION SESSION HELPER ---
export async function ensureAuthSession() {
    if (!auth.currentUser) {
        try {
            await signInAnonymously(auth);
            console.log("Initialized anonymous auth session for guest:", auth.currentUser?.uid);
        } catch (err) {
            console.error("Anonymous authentication error:", err);
            throw err;
        }
    }
    return auth.currentUser;
}
window.ensureAuthSession = ensureAuthSession;

document.addEventListener('click', async (e) => {
    if (e.target && e.target.closest('#guestBtn, .btn-guest, [data-action="guest"], #continueAsGuest')) {
        try {
            await ensureAuthSession();
        } catch (err) {
            console.error("Guest login click error:", err);
        }
    }
});

// --- DATA STRUCTURES (Exact 1:1 match with Kotlin models) ---
const FALLBACK_PRODUCTS = [
    {
        id: "saree-01",
        editorialTitle: "BANARASI",
        fullName: "Handwoven Katan Silk Banarasi Saree",
        category: "SAREES",
        priceInr: 18999,
        description: "Pure Katan silk Banarasi with intricate antique gold zari work and certified Silk Mark craftsmanship.",
        details: "100% Pure Silk • Kadwa Weave • Dry Clean Only • 6.5m with blouse",
        imageUrl: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80",
        variants: [
            { id: "var-1a", colorName: "Royal Burgundy", swatchHex: "#800020", canvasHex: "#4A0E17", imageUrl: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80", inStock: true },
            { id: "var-1b", colorName: "Midnight Emerald", swatchHex: "#0D3822", canvasHex: "#082114", imageUrl: "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=800&q=80", inStock: true },
            { id: "var-1c", colorName: "Obsidian Charcoal", swatchHex: "#1A1A1A", canvasHex: "#101010", imageUrl: "https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=800&q=80", inStock: true }
        ]
    },
    {
        id: "saree-02",
        editorialTitle: "KANJEEVARAM",
        fullName: "Heritage Temple Border Kanjeevaram Silk",
        category: "SAREES",
        priceInr: 24999,
        description: "Heavy Korvai woven Kanjeevaram featuring pure silver zari dipped in 24k gold, passed through master looms.",
        details: "Pure Mulberry Silk • Korvai Technique • GI Tagged • 6.3m length",
        imageUrl: "https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=800&q=80",
        variants: [
            { id: "var-2a", colorName: "Sunset Vermilion", swatchHex: "#C0392B", canvasHex: "#6E1B1B", imageUrl: "https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=800&q=80", inStock: true },
            { id: "var-2b", colorName: "Peacock Royal Blue", swatchHex: "#1B365D", canvasHex: "#0E1E38", imageUrl: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80", inStock: true }
        ]
    },
    {
        id: "clothes-01",
        editorialTitle: "ANARKALI",
        fullName: "Royal Embroidered Chiffon Anarkali Set",
        category: "CLOTHES",
        priceInr: 16999,
        description: "3-piece couture floor-length Anarkali with intricate Zardozi hand-embroidery on pure silk chiffon.",
        details: "Pure Silk Chiffon • Zardozi Embroidery • Dupatta & Churidar Included",
        imageUrl: "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=800&q=80",
        variants: [
            { id: "var-3a", colorName: "Mint Aqua", swatchHex: "#5FA79E", canvasHex: "#2C5B55", imageUrl: "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=800&q=80", inStock: true },
            { id: "var-3b", colorName: "Rose Gold Blush", swatchHex: "#B76E79", canvasHex: "#5C3138", imageUrl: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80", inStock: true }
        ]
    },
    {
        id: "jewel-01",
        editorialTitle: "KUNDAN",
        fullName: "Temple Architecture Uncut Diamond Polki Choker",
        category: "JEWELLERY",
        priceInr: 28999,
        description: "Handcrafted 22k gold plated silver choker with uncut polki diamonds and Zambian emerald beads.",
        details: "925 Silver Base • 22k Gold Foil • Natural Zambian Emeralds",
        imageUrl: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=800&q=80",
        variants: [
            { id: "var-4a", colorName: "Antique Gold & Emerald", swatchHex: "#8C6D3F", canvasHex: "#3D2E14", imageUrl: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=800&q=80", inStock: true },
            { id: "var-4b", colorName: "Royal Sapphire Blue", swatchHex: "#0F52BA", canvasHex: "#0A295C", imageUrl: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=800&q=80", inStock: true }
        ]
    }
];

// --- APP STATE ---
const state = {
    products: [],
    selectedCategory: 'ALL',
    searchQuery: '',
    selectedVariants: {}, // productId -> variantIndex
    wishlist: new Set(JSON.parse(localStorage.getItem('artpoure_wishlist') || '[]')),
    cart: JSON.parse(localStorage.getItem('artpoure_cart') || '[]'),
    appointments: JSON.parse(localStorage.getItem('artpoure_appointments') || '[]'),
    orders: JSON.parse(localStorage.getItem('artpoure_orders') || '[]'),
    theme: localStorage.getItem('artpoure_theme') || 'light',
    appliedPromoCode: localStorage.getItem('artpoure_promo_code') || null,
    selectedPaymentMethod: 'RAZORPAY',
    deliveryAddress: JSON.parse(localStorage.getItem('artpoure_delivery_address') || 'null') || {
        id: 'addr_home',
        label: 'Home',
        houseFlat: 'Flat 4B, Emerald Residency',
        street: '289 Outer Ring Road',
        area: 'Horamavu',
        city: 'Bengaluru',
        pinCode: '560043',
        fullDisplay: '289, Horamavu, Bengaluru - 560043',
        isGps: false
    },
    savedAddresses: JSON.parse(localStorage.getItem('artpoure_saved_address_list') || 'null') || [
        {
            id: 'addr_home',
            label: 'Home',
            houseFlat: 'Flat 4B, Emerald Residency',
            floor: '4th Floor',
            street: '289 Outer Ring Road',
            area: 'Horamavu',
            city: 'Bengaluru',
            pinCode: '560043',
            fullDisplay: 'Flat 4B, 289 Outer Ring Road, Horamavu, Bengaluru - 560043'
        },
        {
            id: 'addr_work',
            label: 'Work',
            houseFlat: 'Level 8',
            floor: '8th Floor',
            street: 'Prestige Tech Park',
            area: 'Kadubeesanahalli, Outer Ring Road',
            city: 'Bengaluru',
            pinCode: '560103',
            fullDisplay: 'Level 8, Prestige Tech Park, Kadubeesanahalli, Bengaluru - 560103'
        },
        {
            id: 'addr_other',
            label: 'Studio',
            houseFlat: 'Flat 4B',
            floor: '4th Floor',
            street: '74 Park Street',
            area: 'South Bombay',
            city: 'Mumbai',
            pinCode: '400001',
            fullDisplay: 'Flat 4B, 74 Park Street, South Bombay, Mumbai - 400001'
        }
    ]
};

// --- DOM ELEMENTS ---
const elements = {
    headerWrapper: document.getElementById('headerWrapper'),
    categoryChips: document.getElementById('categoryChips'),
    productGrid: document.getElementById('productGrid'),
    bottomNavPill: document.getElementById('bottomNavPill'),
    searchToggleBtn: document.getElementById('searchToggleBtn'),
    searchContainer: document.getElementById('searchContainer'),
    searchInput: document.getElementById('searchInput'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    wishlistBadge: document.getElementById('wishlistBadge'),
    cartBadge: document.getElementById('cartBadge'),
    cartDrawerOverlay: document.getElementById('cartDrawerOverlay'),
    cartTab: document.getElementById('cartTab'),
    artclusiveTab: document.getElementById('artclusiveTab'),
    collectionTab: document.getElementById('collectionTab'),
    mainContent: document.querySelector('.main-content'),
    artclusivePage: document.getElementById('artclusivePage'),
    vaultGrid: document.getElementById('vaultGrid'),
    openConsultationBtn: document.getElementById('openConsultationBtn'),
    closeConsultationBtn: document.getElementById('closeConsultationBtn'),
    consultationOverlay: document.getElementById('consultationOverlay'),
    submitConsultationBtn: document.getElementById('submitConsultationBtn'),
    closeCartBtn: document.getElementById('closeCartBtn'),
    cartItemsList: document.getElementById('cartItemsList'),
    cartTotalSum: document.getElementById('cartTotalSum'),
    starburstCanvas: document.getElementById('starburstCanvas'),
    brandTitle: document.querySelector('.brand-title'),
    brandTagline: document.querySelector('.brand-tagline'),
    // Checkout Elements (1:1 with Android CheckoutScreen.kt)
    checkoutPage: document.getElementById('checkoutPage'),
    checkoutEmptyState: document.getElementById('checkoutEmptyState'),
    checkoutEmptyBrowseBtn: document.getElementById('checkoutEmptyBrowseBtn'),
    checkoutBackBtn: document.getElementById('checkoutBackBtn'),
    proceedCheckoutBtn: document.getElementById('proceedCheckoutBtn'),
    checkoutReceiverName: document.getElementById('checkoutReceiverName'),
    checkoutReceiverPhone: document.getElementById('checkoutReceiverPhone'),
    checkoutHouseFlat: document.getElementById('checkoutHouseFlat'),
    checkoutFloor: document.getElementById('checkoutFloor'),
    checkoutStreet: document.getElementById('checkoutStreet'),
    checkoutArea: document.getElementById('checkoutArea'),
    checkoutCity: document.getElementById('checkoutCity'),
    checkoutPinCode: document.getElementById('checkoutPinCode'),
    errReceiverName: document.getElementById('errReceiverName'),
    errReceiverPhone: document.getElementById('errReceiverPhone'),
    errHouseFlat: document.getElementById('errHouseFlat'),
    errStreet: document.getElementById('errStreet'),
    errArea: document.getElementById('errArea'),
    errCity: document.getElementById('errCity'),
    errPinCode: document.getElementById('errPinCode'),
    payOptionUpi: document.getElementById('payOptionUpi'),
    payOptionCod: document.getElementById('payOptionCod'),
    checkoutItemPreviews: document.getElementById('checkoutItemPreviews'),
    checkoutPromoInput: document.getElementById('checkoutPromoInput'),
    checkoutPromoBtn: document.getElementById('checkoutPromoBtn'),
    promoFeedback: document.getElementById('promoFeedback'),
    summarySubtotal: document.getElementById('summarySubtotal'),
    summaryDiscountRow: document.getElementById('summaryDiscountRow'),
    summaryPromoLabel: document.getElementById('summaryPromoLabel'),
    summaryDiscount: document.getElementById('summaryDiscount'),
    summaryShipping: document.getElementById('summaryShipping'),
    summaryGrandTotal: document.getElementById('summaryGrandTotal'),
    placeOrderBtn: document.getElementById('placeOrderBtn'),
    placeOrderBtnText: document.getElementById('placeOrderBtnText'),
    orderSuccessModal: document.getElementById('orderSuccessModal'),
    orderSuccessId: document.getElementById('orderSuccessId'),
    orderSuccessMeta: document.getElementById('orderSuccessMeta'),
    returnToStoreBtn: document.getElementById('returnToStoreBtn'),
    // Order & Consultation History Elements
    historyHeaderBtn: document.getElementById('historyHeaderBtn'),
    historyOverlay: document.getElementById('historyOverlay'),
    closeHistoryBtn: document.getElementById('closeHistoryBtn'),
    tabAppointmentsBtn: document.getElementById('tabAppointmentsBtn'),
    tabOrdersBtn: document.getElementById('tabOrdersBtn'),
    tabAppointmentsContent: document.getElementById('tabAppointmentsContent'),
    tabOrdersContent: document.getElementById('tabOrdersContent'),
    appointmentsList: document.getElementById('appointmentsList'),
    ordersList: document.getElementById('ordersList'),
    // Consultation Date Elements
    consultDate: document.getElementById('consultDate'),
    consultDateError: document.getElementById('consultDateError'),
    chipDateTomorrow: document.getElementById('chipDateTomorrow'),
    chipDateTwoDays: document.getElementById('chipDateTwoDays'),
    // Delivery Location & Saved Address Elements
    locationLayer: document.getElementById('locationLayer'),
    locationPill: document.getElementById('locationPill'),
    currentAddress: document.getElementById('currentAddress'),
    addressModalOverlay: document.getElementById('addressModalOverlay'),
    closeAddressModalBtn: document.getElementById('closeAddressModalBtn'),
    useCurrentLocationBtn: document.getElementById('useCurrentLocationBtn'),
    gpsActiveBadge: document.getElementById('gpsActiveBadge'),
    gpsStatusText: document.getElementById('gpsStatusText'),
    gpsIconBubble: document.getElementById('gpsIconBubble'),
    toggleAddAddressBtn: document.getElementById('toggleAddAddressBtn'),
    newAddressForm: document.getElementById('newAddressForm'),
    newAddrLabel: document.getElementById('newAddrLabel'),
    newAddrHouse: document.getElementById('newAddrHouse'),
    newAddrStreet: document.getElementById('newAddrStreet'),
    newAddrArea: document.getElementById('newAddrArea'),
    newAddrCity: document.getElementById('newAddrCity'),
    newAddrPin: document.getElementById('newAddrPin'),
    cancelNewAddrBtn: document.getElementById('cancelNewAddrBtn'),
    saveNewAddrBtn: document.getElementById('saveNewAddrBtn'),
    savedAddressesList: document.getElementById('savedAddressesList')
};

// --- INITIALIZATION ---
async function init() {
    applyTheme(state.theme);
    setupScrollPhysics();
    setupEventListeners();
    updateCurrentAddressDisplay();
    await fetchCatalog();
    setupHeroShowcase();
    renderCatalog();
    renderAppointmentsList();
    renderOrdersList();
    updateBadges();
}

// --- FETCH PRODUCTS (Firestore with fallback) ---
async function fetchCatalog() {
    try {
        const querySnapshot = await getDocs(collection(db, "products"));
        const items = [];
        querySnapshot.forEach((docSnap) => {
            items.push({ id: docSnap.id, ...docSnap.data() });
        });
        state.products = items.length > 0 ? items : FALLBACK_PRODUCTS;
    } catch (error) {
        console.warn("Firestore offline or empty. Utilizing curated catalog:", error);
        state.products = FALLBACK_PRODUCTS;
    }

    // Default first variant for all items
    state.products.forEach(p => {
        if (!state.selectedVariants[p.id]) {
            state.selectedVariants[p.id] = 0;
        }
    });
}

// --- RENDER PRODUCT GRID ---
function renderCatalog() {
    const query = state.searchQuery.toLowerCase().trim();
    const filtered = state.products.filter(item => {
        const matchesCategory = state.selectedCategory === 'ALL' || item.category === state.selectedCategory;
        const matchesSearch = !query ||
            item.fullName.toLowerCase().includes(query) ||
            item.editorialTitle.toLowerCase().includes(query);
        return matchesCategory && matchesSearch;
    });

    const collectionCount = document.getElementById('collectionCount');
    if (collectionCount) {
        collectionCount.textContent = `${filtered.length} PIECES`;
    }

    if (filtered.length === 0) {
        elements.productGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                <p style="font-family: var(--font-cinzel); font-size: 16px; margin-bottom: 8px;">NO MASTERPIECES FOUND</p>
                <p style="font-size: 12px;">Try adjusting your category filter or search terms</p>
            </div>
        `;
        return;
    }

    elements.productGrid.innerHTML = filtered.map(product => {
        const activeIdx = state.selectedVariants[product.id] || 0;
        const variant = product.variants[activeIdx] || product.variants[0];
        const isWishlisted = state.wishlist.has(product.id);

        return `
            <article class="product-card" data-id="${product.id}">
                <div class="card-image-box" style="background-color: ${variant.canvasHex || '#2A2825'};">
                    <img class="product-card-img" src="${variant.imageUrl || product.imageUrl}" alt="${product.fullName}">
                    <button class="wishlist-btn ${isWishlisted ? 'active' : ''}" data-wishlist-id="${product.id}" title="Save to Wishlist">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="${isWishlisted ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                        </svg>
                    </button>
                </div>
                <div class="card-info">
                    <div>
                        <h2 class="card-title">${product.editorialTitle}</h2>
                        <p class="card-subtitle">${product.fullName}</p>
                    </div>
                    <div class="card-bottom-row">
                        <div class="card-price-group">
                            <span class="card-price-label">PRICE</span>
                            <span class="card-price">₹${product.priceInr.toLocaleString('en-IN')}</span>
                        </div>
                        <div class="swatch-group">
                            ${product.variants.map((v, i) => `
                                <div class="swatch-dot ${i === activeIdx ? 'active' : ''}"
                                     style="background-color: ${v.swatchHex};"
                                     data-product-id="${product.id}"
                                     data-variant-idx="${i}"
                                     title="${v.colorName}"></div>
                            `).join('')}
                        </div>
                        <button class="quick-add-btn" data-add-id="${product.id}" title="Add to Bag">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                                <line x1="3" y1="6" x2="21" y2="6"></line>
                                <path d="M16 10a4 4 0 0 1-8 0"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            </article>
        `;
    }).join('');

    attachCardEventListeners();
}

// --- CARD EVENTS (Swatches, Wishlist, Quick Add) ---
function attachCardEventListeners() {
    // Color Swatch Selection
    document.querySelectorAll('.swatch-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
            e.stopPropagation();
            const prodId = dot.dataset.productId;
            const varIdx = parseInt(dot.dataset.variantIdx, 10);
            state.selectedVariants[prodId] = varIdx;
            renderCatalog();
        });
    });

    // Wishlist Toggle
    document.querySelectorAll('.wishlist-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.wishlistId;
            if (state.wishlist.has(id)) {
                state.wishlist.delete(id);
            } else {
                state.wishlist.add(id);
            }
            localStorage.setItem('artpoure_wishlist', JSON.stringify([...state.wishlist]));
            updateBadges();
            renderCatalog();
        });
    });

    // Quick Add to Bag
    document.querySelectorAll('.quick-add-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.addId;
            addToCart(id);
        });
    });
}

// --- CART STATE MANAGEMENT ---
function addToCart(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    const variantIdx = state.selectedVariants[productId] || 0;
    const variant = product.variants[variantIdx];

    const existingIndex = state.cart.findIndex(item => item.product.id === productId && item.variant.id === variant.id);
    if (existingIndex > -1) {
        state.cart[existingIndex].quantity += 1;
    } else {
        state.cart.push({ product, variant, quantity: 1 });
    }

    localStorage.setItem('artpoure_cart', JSON.stringify(state.cart));
    updateBadges();
    openCartDrawer();
}

function updateCartQuantity(index, delta) {
    state.cart[index].quantity += delta;
    if (state.cart[index].quantity <= 0) {
        state.cart.splice(index, 1);
    }
    localStorage.setItem('artpoure_cart', JSON.stringify(state.cart));
    updateBadges();
    renderCartDrawer();
}

function openCartDrawer() {
    renderCartDrawer();
    elements.cartDrawerOverlay.classList.add('open');
}

function closeCartDrawer() {
    elements.cartDrawerOverlay.classList.remove('open');
}

function renderCartDrawer() {
    if (state.cart.length === 0) {
        elements.cartItemsList.innerHTML = `
            <div style="text-align: center; padding: 40px 10px; color: var(--text-secondary);">
                <p style="font-family: var(--font-cinzel); font-size: 14px; margin-bottom: 6px;">YOUR BAG IS EMPTY</p>
                <p style="font-size: 11px;">Explore our handcrafted Banarasi & Kanjeevaram weaves.</p>
            </div>
        `;
        elements.cartTotalSum.textContent = "₹0";
        return;
    }

    let total = 0;
    elements.cartItemsList.innerHTML = state.cart.map((item, index) => {
        const itemTotal = item.product.priceInr * item.quantity;
        total += itemTotal;
        return `
            <div class="cart-item-card">
                <img src="${item.variant.imageUrl}" class="cart-item-img" alt="${item.product.fullName}">
                <div class="cart-item-info">
                    <p class="cart-item-title">${item.product.editorialTitle}</p>
                    <p style="font-size: 10px; color: var(--text-secondary);">${item.variant.colorName}</p>
                    <p class="cart-item-price">₹${itemTotal.toLocaleString('en-IN')}</p>
                    <div style="display: flex; gap: 8px; align-items: center; margin-top: 6px;">
                        <button class="cart-qty-btn" data-index="${index}" data-delta="-1" style="background: var(--surface); border: 1px solid var(--border); border-radius: 4px; width: 22px; height: 22px; cursor: pointer;">-</button>
                        <span style="font-size: 12px; font-weight: 700;">${item.quantity}</span>
                        <button class="cart-qty-btn" data-index="${index}" data-delta="1" style="background: var(--surface); border: 1px solid var(--border); border-radius: 4px; width: 22px; height: 22px; cursor: pointer;">+</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    elements.cartTotalSum.textContent = `₹${total.toLocaleString('en-IN')}`;

    document.querySelectorAll('.cart-qty-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index, 10);
            const delta = parseInt(btn.dataset.delta, 10);
            updateCartQuantity(index, delta);
        });
    });
}

function updateBadges() {
    elements.wishlistBadge.textContent = state.wishlist.size;
    const cartCount = state.cart.reduce((sum, item) => sum + item.quantity, 0);
    elements.cartBadge.textContent = cartCount;
}

// --- AUTO-CYCLING NEW ARRIVALS HERO (Matches Android Jetpack Compose HorizontalPager) ---
let heroCycleTimer = null;
let currentHeroIndex = 0;

function setupHeroShowcase() {
    const heroCard = document.getElementById('heroCard');
    const heroIndicators = document.getElementById('heroIndicators');
    const collectionCount = document.getElementById('collectionCount');

    if (!heroCard || state.products.length === 0) return;

    if (collectionCount) {
        collectionCount.textContent = `${state.products.length} PIECES`;
    }

    // Build indicators
    if (heroIndicators) {
        heroIndicators.innerHTML = state.products.map((_, i) => `
            <div class="hero-indicator-dot ${i === currentHeroIndex ? 'active' : ''}" data-index="${i}"></div>
        `).join('');

        heroIndicators.querySelectorAll('.hero-indicator-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                const idx = parseInt(dot.dataset.index, 10);
                showHeroIndex(idx);
                restartHeroCycle();
            });
        });
    }

    showHeroIndex(currentHeroIndex);
    startHeroCycle();
}

function showHeroIndex(index) {
    if (state.products.length === 0) return;
    currentHeroIndex = (index + state.products.length) % state.products.length;
    const product = state.products[currentHeroIndex];
    const activeVarIdx = state.selectedVariants[product.id] || 0;
    const variant = product.variants[activeVarIdx] || product.variants[0];

    const heroCard = document.getElementById('heroCard');
    const heroModelImg = document.getElementById('heroModelImg');
    const heroTitle = document.getElementById('heroTitle');
    const heroSub = document.getElementById('heroSub');
    const heroPrice = document.getElementById('heroPrice');
    const heroPageCounter = document.getElementById('heroPageCounter');

    if (heroCard) heroCard.style.backgroundColor = variant.canvasHex || '#4A0E17';
    if (heroTitle) heroTitle.textContent = product.editorialTitle;
    if (heroSub) heroSub.textContent = product.details || product.fullName;
    if (heroPrice) heroPrice.textContent = `₹${product.priceInr.toLocaleString('en-IN')}`;
    if (heroPageCounter) {
        const total = state.products.length.toString().padStart(2, '0');
        const curr = (currentHeroIndex + 1).toString().padStart(2, '0');
        heroPageCounter.textContent = `${curr} / ${total}`;
    }
    if (heroModelImg) {
        heroModelImg.src = variant.imageUrl || product.imageUrl;
        heroModelImg.alt = product.fullName;
    }

    // Update indicator dots
    document.querySelectorAll('.hero-indicator-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === currentHeroIndex);
    });
}

function startHeroCycle() {
    if (heroCycleTimer) clearInterval(heroCycleTimer);
    heroCycleTimer = setInterval(() => {
        showHeroIndex(currentHeroIndex + 1);
    }, 2800);
}

function restartHeroCycle() {
    if (heroCycleTimer) clearInterval(heroCycleTimer);
    startHeroCycle();
}

// --- SCROLL PHYSICS (Exact match to Android Header & Pill cascading collapse) ---
function setupScrollPhysics() {
    let lastScrollY = window.scrollY;

    window.addEventListener('scroll', () => {
        const currentY = window.scrollY;

        // Header Collapse threshold
        if (currentY > 36) {
            elements.headerWrapper.classList.add('scrolled');
            elements.bottomNavPill.classList.add('compact');
        } else {
            elements.headerWrapper.classList.remove('scrolled');
            elements.bottomNavPill.classList.remove('compact');
        }

        lastScrollY = currentY;
    }, { passive: true });
}

// --- THEME SWITCHER (Light / Dark Mode) & AMBIENT VIDEO ENGINE ---
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('artpoure_theme', theme);
    state.theme = theme;
    updateAmbientVideo();
}

function updateAmbientVideo() {
    const video = document.getElementById('ambientVideo');
    if (!video) return;

    const isArtclusive = document.body.classList.contains('artclusive-mode');
    const isDark = state.theme === 'dark';

    let targetSrc = '';
    if (isArtclusive) {
        // ArtClusive background videos: exclusive_light.mp4 for dark mode, exclusive_dark.mp4 for light mode
        targetSrc = isDark ? 'videos/exclusive_light.mp4' : 'videos/exclusive_dark.mp4';
    } else {
        targetSrc = 'https://assets.mixkit.co/videos/preview/mixkit-curtain-of-golden-silk-blowing-in-the-wind-41551-large.mp4';
    }

    const currentSource = video.querySelector('source');
    if (currentSource && currentSource.getAttribute('src') !== targetSrc) {
        currentSource.setAttribute('src', targetSrc);
        video.load();
        video.play().catch(e => console.warn('Ambient video autoplay note:', e));
    }
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
    // Category tabs
    elements.categoryChips.addEventListener('click', (e) => {
        const target = e.target.closest('.category-chip');
        if (!target) return;
        document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
        target.classList.add('active');
        state.selectedCategory = target.dataset.category;
        renderCatalog();
    });

    // Search Toggle
    elements.searchToggleBtn.addEventListener('click', () => {
        elements.searchContainer.classList.toggle('active');
        if (elements.searchContainer.classList.contains('active')) {
            elements.searchInput.focus();
        } else {
            state.searchQuery = '';
            elements.searchInput.value = '';
            renderCatalog();
        }
    });

    elements.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderCatalog();
    });

    // Theme toggle
    elements.themeToggleBtn.addEventListener('click', () => {
        const next = state.theme === 'light' ? 'dark' : 'light';
        applyTheme(next);
    });

    // Bottom Navigation switching between Collection & ArtClusive
    elements.collectionTab.addEventListener('click', () => {
        elements.collectionTab.classList.add('active');
        if (elements.artclusiveTab) elements.artclusiveTab.classList.remove('active');
        if (elements.mainContent) elements.mainContent.style.display = 'block';
        if (elements.artclusivePage) elements.artclusivePage.style.display = 'none';
        if (elements.checkoutPage) elements.checkoutPage.style.display = 'none';
        document.body.classList.remove('artclusive-mode');
        document.body.classList.remove('checkout-mode');
        if (elements.brandTitle) elements.brandTitle.textContent = 'ARTPOURE';
        if (elements.brandTagline) elements.brandTagline.textContent = 'HAUTE ETHNIC EDITORIAL';
        updateAmbientVideo();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    if (elements.artclusiveTab) {
        elements.artclusiveTab.addEventListener('click', () => {
            const rect = elements.artclusiveTab.getBoundingClientRect();
            triggerStarburstTransition(rect, () => {
                // Peak supernova burst callback (reveal ArtClusive page)
                elements.artclusiveTab.classList.add('active');
                elements.collectionTab.classList.remove('active');
                if (elements.mainContent) elements.mainContent.style.display = 'none';
                if (elements.artclusivePage) elements.artclusivePage.style.display = 'block';
                if (elements.checkoutPage) elements.checkoutPage.style.display = 'none';
                document.body.classList.add('artclusive-mode');
                document.body.classList.remove('checkout-mode');
                if (elements.brandTitle) elements.brandTitle.textContent = 'ARTCLUSIVE';
                if (elements.brandTagline) elements.brandTagline.textContent = 'HAUTE ATELIER & BESPOKE VAULT';
                updateAmbientVideo();
                renderVaultPieces();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });
    }

    elements.cartTab.addEventListener('click', () => {
        if (state.cart.length > 0) {
            openCheckoutScreen();
        } else {
            openCartDrawer();
        }
    });

    elements.closeCartBtn.addEventListener('click', () => {
        closeCartDrawer();
    });

    elements.cartDrawerOverlay.addEventListener('click', (e) => {
        if (e.target === elements.cartDrawerOverlay) {
            closeCartDrawer();
        }
    });

    // Checkout Navigation & Interactions
    if (elements.proceedCheckoutBtn) {
        elements.proceedCheckoutBtn.addEventListener('click', () => {
            openCheckoutScreen();
        });
    }

    if (elements.checkoutBackBtn) {
        elements.checkoutBackBtn.addEventListener('click', () => {
            closeCheckoutScreen();
        });
    }

    if (elements.checkoutEmptyBrowseBtn) {
        elements.checkoutEmptyBrowseBtn.addEventListener('click', () => {
            closeCheckoutScreen();
        });
    }

    // Payment Option Switching
    if (elements.payOptionUpi) {
        elements.payOptionUpi.addEventListener('click', () => {
            selectPaymentMethod('RAZORPAY');
        });
    }
    if (elements.payOptionCard) {
        elements.payOptionCard.addEventListener('click', () => {
            selectPaymentMethod('RAZORPAY');
        });
    }
    if (elements.payOptionCod) {
        elements.payOptionCod.addEventListener('click', () => {
            selectPaymentMethod('COD');
        });
    }

    // Bespoke Custom Commission Token link dynamic generator
    const bespokeAmountInput = document.getElementById('bespokeTokenAmount');
    const bespokePayLink = document.getElementById('bespokePayLink');
    if (bespokeAmountInput && bespokePayLink) {
        bespokeAmountInput.addEventListener('input', (e) => {
            const val = Math.max(100, Number(e.target.value) || 5000);
            bespokePayLink.href = `https://razorpay.me/@shibmalyaananya/${val}`;
        });
    }

    // Promo Code Application
    if (elements.checkoutPromoBtn) {
        elements.checkoutPromoBtn.addEventListener('click', () => {
            applyCheckoutPromo();
        });
    }
    if (elements.checkoutPromoInput) {
        elements.checkoutPromoInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyCheckoutPromo();
            }
        });
    }

    // Place Order Validation & Submission
    if (elements.placeOrderBtn) {
        elements.placeOrderBtn.addEventListener('click', () => {
            validateAndPlaceOrder();
        });
    }

    // Return to Store from Order Success Modal
    if (elements.returnToStoreBtn) {
        elements.returnToStoreBtn.addEventListener('click', () => {
            if (elements.orderSuccessModal) elements.orderSuccessModal.style.display = 'none';
            closeCheckoutScreen();
        });
    }

    // Live Input Validation Clearing (Ensures responsive error dismissal as user types)
    const attachLiveValidator = (inputEl, errorEl, validatorFn) => {
        if (!inputEl) return;
        inputEl.addEventListener('input', () => {
            if (validatorFn(inputEl.value)) {
                inputEl.classList.remove('input-invalid');
                if (errorEl) errorEl.style.display = 'none';
            }
        });
    };

    attachLiveValidator(elements.checkoutReceiverName, elements.errReceiverName, v => v.trim().length > 0);
    if (elements.checkoutReceiverPhone) {
        elements.checkoutReceiverPhone.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
            if (/^\d{10}$/.test(e.target.value)) {
                elements.checkoutReceiverPhone.classList.remove('input-invalid');
                if (elements.errReceiverPhone) elements.errReceiverPhone.style.display = 'none';
            }
        });
    }
    attachLiveValidator(elements.checkoutHouseFlat, elements.errHouseFlat, v => v.trim().length > 0);
    attachLiveValidator(elements.checkoutStreet, elements.errStreet, v => v.trim().length > 0);
    attachLiveValidator(elements.checkoutArea, elements.errArea, v => v.trim().length > 0);
    attachLiveValidator(elements.checkoutCity, elements.errCity, v => v.trim().length > 0);
    if (elements.checkoutPinCode) {
        elements.checkoutPinCode.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
            if (/^\d{6}$/.test(e.target.value)) {
                elements.checkoutPinCode.classList.remove('input-invalid');
                if (elements.errPinCode) elements.errPinCode.style.display = 'none';
            }
        });
    }

    // Consultation Modal
    if (elements.openConsultationBtn && elements.consultationOverlay) {
        elements.openConsultationBtn.addEventListener('click', () => {
            const nameInput = document.getElementById('consultName');
            const phoneInput = document.getElementById('consultPhone');
            const nameError = document.getElementById('consultNameError');
            const phoneError = document.getElementById('consultPhoneError');
            if (nameError) nameError.style.display = 'none';
            if (phoneError) phoneError.style.display = 'none';
            if (nameInput) nameInput.classList.remove('input-invalid');
            if (phoneInput) phoneInput.classList.remove('input-invalid');

            // Auto-fetch profile name and number if user is logged in (strip +91, exactly 10 digits)
            const currentUser = auth.currentUser;
            const profileName = (currentUser && currentUser.displayName) || localStorage.getItem('user_profile_name') || 'Ananya Dey';
            const rawProfilePhone = (currentUser && currentUser.phoneNumber) || localStorage.getItem('user_profile_phone') || '9876543210';
            const cleanProfilePhone = rawProfilePhone.replace(/\D/g, '').slice(-10);

            if (nameInput && !nameInput.value.trim() && profileName) {
                nameInput.value = profileName;
            }
            if (phoneInput && !phoneInput.value.trim() && cleanProfilePhone) {
                phoneInput.value = cleanProfilePhone;
            }

            // Initialize consultation date to tomorrow
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toISOString().split('T')[0];
            const dateInput = document.getElementById('consultDate');
            if (dateInput) {
                dateInput.min = tomorrowStr;
                if (!dateInput.value) {
                    dateInput.value = tomorrowStr;
                }
            }

            elements.consultationOverlay.classList.add('open');
        });
    }

    const consultPhoneEl = document.getElementById('consultPhone');
    if (consultPhoneEl) {
        consultPhoneEl.addEventListener('input', (e) => {
            // Strictly allow only digits and at most 10 digits (no +91 or extra characters)
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
            const phoneError = document.getElementById('consultPhoneError');
            if (e.target.value.length === 10) {
                if (phoneError) phoneError.style.display = 'none';
                e.target.classList.remove('input-invalid');
            }
        });
    }

    const consultNameEl = document.getElementById('consultName');
    if (consultNameEl) {
        consultNameEl.addEventListener('input', (e) => {
            const nameError = document.getElementById('consultNameError');
            if (e.target.value.trim().length > 0) {
                if (nameError) nameError.style.display = 'none';
                e.target.classList.remove('input-invalid');
            }
        });
    }

    const consultDateEl = document.getElementById('consultDate');
    if (consultDateEl) {
        consultDateEl.addEventListener('change', (e) => {
            const dateError = document.getElementById('consultDateError');
            if (e.target.value) {
                if (dateError) dateError.style.display = 'none';
                e.target.classList.remove('input-invalid');
            }
        });
    }

    const chipDateTomorrow = document.getElementById('chipDateTomorrow');
    if (chipDateTomorrow) {
        chipDateTomorrow.addEventListener('click', () => {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            const dateInput = document.getElementById('consultDate');
            if (dateInput) {
                dateInput.value = d.toISOString().split('T')[0];
                const dateError = document.getElementById('consultDateError');
                if (dateError) dateError.style.display = 'none';
                dateInput.classList.remove('input-invalid');
            }
        });
    }

    const chipDateTwoDays = document.getElementById('chipDateTwoDays');
    if (chipDateTwoDays) {
        chipDateTwoDays.addEventListener('click', () => {
            const d = new Date();
            d.setDate(d.getDate() + 2);
            const dateInput = document.getElementById('consultDate');
            if (dateInput) {
                dateInput.value = d.toISOString().split('T')[0];
                const dateError = document.getElementById('consultDateError');
                if (dateError) dateError.style.display = 'none';
                dateInput.classList.remove('input-invalid');
            }
        });
    }

    if (elements.closeConsultationBtn && elements.consultationOverlay) {
        elements.closeConsultationBtn.addEventListener('click', () => {
            elements.consultationOverlay.classList.remove('open');
        });
    }
    if (elements.consultationOverlay) {
        elements.consultationOverlay.addEventListener('click', (e) => {
            if (e.target === elements.consultationOverlay) {
                elements.consultationOverlay.classList.remove('open');
            }
        });
    }

    // Order & Consultation History Header & Modal Listeners
    if (elements.historyHeaderBtn) {
        elements.historyHeaderBtn.addEventListener('click', () => {
            openHistoryModal('appointments');
        });
    }
    if (elements.closeHistoryBtn && elements.historyOverlay) {
        elements.closeHistoryBtn.addEventListener('click', () => {
            closeHistoryModal();
        });
    }
    if (elements.historyOverlay) {
        elements.historyOverlay.addEventListener('click', (e) => {
            if (e.target === elements.historyOverlay) {
                closeHistoryModal();
            }
        });
    }
    if (elements.tabAppointmentsBtn) {
        elements.tabAppointmentsBtn.addEventListener('click', () => {
            switchHistoryTab('appointments');
        });
    }
    if (elements.tabOrdersBtn) {
        elements.tabOrdersBtn.addEventListener('click', () => {
            switchHistoryTab('orders');
        });
    }

    if (elements.submitConsultationBtn && elements.consultationOverlay) {
        elements.submitConsultationBtn.addEventListener('click', async () => {
            const nameInput = document.getElementById('consultName');
            const phoneInput = document.getElementById('consultPhone');
            const dateInput = document.getElementById('consultDate');
            const weaveInput = document.getElementById('consultWeave');
            const nameError = document.getElementById('consultNameError');
            const phoneError = document.getElementById('consultPhoneError');
            const dateError = document.getElementById('consultDateError');

            const name = nameInput ? nameInput.value.trim() : '';
            const phone = phoneInput ? phoneInput.value.trim() : '';
            const phoneDigits = phone.replace(/\D/g, '');
            const date = dateInput ? dateInput.value.trim() : '';

            let isValid = true;
            if (!name) {
                if (nameError) nameError.style.display = 'block';
                if (nameInput) nameInput.classList.add('input-invalid');
                isValid = false;
            } else {
                if (nameError) nameError.style.display = 'none';
                if (nameInput) nameInput.classList.remove('input-invalid');
            }

            // Must be exactly 10 digits and contain no +91 or non-digits
            if (phone.length !== 10 || phoneDigits.length !== 10) {
                if (phoneError) {
                    phoneError.textContent = "Please enter a valid 10-digit mobile number (without +91)";
                    phoneError.style.display = 'block';
                }
                if (phoneInput) phoneInput.classList.add('input-invalid');
                isValid = false;
            } else {
                if (phoneError) phoneError.style.display = 'none';
                if (phoneInput) phoneInput.classList.remove('input-invalid');
            }

            // Preferred Consultation Date (Compulsory)
            if (!date) {
                if (dateError) dateError.style.display = 'block';
                if (dateInput) dateInput.classList.add('input-invalid');
                isValid = false;
            } else {
                if (dateError) dateError.style.display = 'none';
                if (dateInput) dateInput.classList.remove('input-invalid');
            }

            if (!isValid) return;

            const weave = weaveInput ? weaveInput.value.trim() : '';
            const weaveSuffix = weave ? ` for "${weave}"` : '';

            const aptId = `APT-${Math.floor(1000 + Math.random() * 9000)}`;
            await ensureAuthSession();
            const appointment = {
                id: aptId,
                userId: auth.currentUser ? auth.currentUser.uid : null,
                clientName: name,
                clientPhone: phone,
                preferredDate: date,
                preferredWeave: weave,
                status: 'CONFIRMED',
                bookedAt: new Date().toISOString()
            };

            state.appointments.unshift(appointment);
            localStorage.setItem('artpoure_appointments', JSON.stringify(state.appointments));

            try {
                await setDoc(doc(db, "appointments", aptId), appointment);
            } catch (err) {
                console.warn("Firestore appointment sync fallback:", err);
            }

            elements.consultationOverlay.classList.remove('open');
            renderAppointmentsList();
            alert(`Consultation Confirmed for ${date}${weaveSuffix}! View under Order & Consultation History.`);
        });
    }

    // Delivery Location & Saved Address Listeners
    if (elements.locationPill) {
        elements.locationPill.addEventListener('click', () => {
            openAddressModal();
        });
    }

    if (elements.closeAddressModalBtn) {
        elements.closeAddressModalBtn.addEventListener('click', () => {
            closeAddressModal();
        });
    }

    if (elements.addressModalOverlay) {
        elements.addressModalOverlay.addEventListener('click', (e) => {
            if (e.target === elements.addressModalOverlay) {
                closeAddressModal();
            }
        });
    }

    if (elements.useCurrentLocationBtn) {
        elements.useCurrentLocationBtn.addEventListener('click', () => {
            useCurrentLocation();
        });
    }

    if (elements.toggleAddAddressBtn && elements.newAddressForm) {
        elements.toggleAddAddressBtn.addEventListener('click', () => {
            const isHidden = elements.newAddressForm.style.display === 'none';
            elements.newAddressForm.style.display = isHidden ? 'flex' : 'none';
            elements.toggleAddAddressBtn.textContent = isHidden ? '− HIDE' : '+ ADD NEW';
        });
    }

    if (elements.cancelNewAddrBtn && elements.newAddressForm) {
        elements.cancelNewAddrBtn.addEventListener('click', () => {
            elements.newAddressForm.style.display = 'none';
            if (elements.toggleAddAddressBtn) elements.toggleAddAddressBtn.textContent = '+ ADD NEW';
        });
    }

    if (elements.saveNewAddrBtn) {
        elements.saveNewAddrBtn.addEventListener('click', () => {
            saveNewCustomAddress();
        });
    }
}

// --- CHECKOUT & VALIDATION ENGINE (1:1 with Android CheckoutScreen.kt) ---

function openCheckoutScreen() {
    closeCartDrawer();
    document.body.classList.add('checkout-mode');

    if (elements.mainContent) elements.mainContent.style.display = 'none';
    if (elements.artclusivePage) elements.artclusivePage.style.display = 'none';
    if (elements.checkoutPage) elements.checkoutPage.style.display = 'block';

    const checkoutContainer = document.querySelector('.checkout-container');

    if (state.cart.length === 0) {
        if (elements.checkoutEmptyState) elements.checkoutEmptyState.style.display = 'block';
        if (checkoutContainer) checkoutContainer.style.display = 'none';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    if (elements.checkoutEmptyState) elements.checkoutEmptyState.style.display = 'none';
    if (checkoutContainer) checkoutContainer.style.display = 'grid';

    // Auto-fetch profile name and phone from Auth or LocalStorage if not already filled
    const currentUser = auth.currentUser;
    const profileName = (currentUser && currentUser.displayName) || localStorage.getItem('user_profile_name') || 'Ananya Dey';
    let profilePhone = (currentUser && currentUser.phoneNumber) || localStorage.getItem('user_profile_phone') || '9876543210';
    profilePhone = profilePhone.replace(/\D/g, '');
    if (profilePhone.length === 12 && profilePhone.startsWith('91')) {
        profilePhone = profilePhone.slice(2);
    }
    if (profilePhone.length > 10) {
        profilePhone = profilePhone.slice(-10);
    }
    if (!profilePhone) {
        profilePhone = '9876543210';
    }

    if (elements.checkoutReceiverName && !elements.checkoutReceiverName.value.trim() && profileName) {
        elements.checkoutReceiverName.value = profileName;
    }
    if (elements.checkoutReceiverPhone && !elements.checkoutReceiverPhone.value.trim()) {
        elements.checkoutReceiverPhone.value = profilePhone;
    }

    // Load saved address from LocalStorage if available or sensible defaults
    try {
        const savedAddr = JSON.parse(localStorage.getItem('artpoure_delivery_address') || '{}');
        if (elements.checkoutHouseFlat && !elements.checkoutHouseFlat.value) {
            elements.checkoutHouseFlat.value = savedAddr.houseFlat || 'Flat 4B, Emerald Residency';
        }
        if (elements.checkoutFloor && !elements.checkoutFloor.value) {
            elements.checkoutFloor.value = savedAddr.floor || '4th Floor';
        }
        if (elements.checkoutStreet && !elements.checkoutStreet.value) {
            elements.checkoutStreet.value = savedAddr.street || '289 Outer Ring Road';
        }
        if (elements.checkoutArea && !elements.checkoutArea.value) {
            elements.checkoutArea.value = savedAddr.area || 'Horamavu';
        }
        if (elements.checkoutCity && !elements.checkoutCity.value) {
            elements.checkoutCity.value = savedAddr.city || 'Bengaluru';
        }
        if (elements.checkoutPinCode && !elements.checkoutPinCode.value) {
            elements.checkoutPinCode.value = savedAddr.pinCode || '560043';
        }
    } catch (e) {
        // Ignore JSON parse error
    }

    // Clear previous validation error highlights
    clearCheckoutValidationErrors();

    renderCheckoutSummary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeCheckoutScreen() {
    document.body.classList.remove('checkout-mode');
    if (elements.checkoutPage) elements.checkoutPage.style.display = 'none';
    if (document.body.classList.contains('artclusive-mode')) {
        if (elements.artclusivePage) elements.artclusivePage.style.display = 'block';
    } else {
        if (elements.mainContent) elements.mainContent.style.display = 'block';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearCheckoutValidationErrors() {
    const errorIds = [
        'errReceiverName', 'errReceiverPhone', 'errHouseFlat',
        'errStreet', 'errArea', 'errCity', 'errPinCode'
    ];
    errorIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const inputs = [
        elements.checkoutReceiverName, elements.checkoutReceiverPhone,
        elements.checkoutHouseFlat, elements.checkoutStreet,
        elements.checkoutArea, elements.checkoutCity, elements.checkoutPinCode
    ];
    inputs.forEach(inp => {
        if (inp) inp.classList.remove('input-invalid');
    });
}

function renderCheckoutSummary() {
    const subtotal = state.cart.reduce((sum, item) => sum + (item.product.priceInr * item.quantity), 0);
    const discount = state.appliedPromoCode === 'FIRST10' ? Math.round(subtotal * 0.10) : 0;
    const shipping = (subtotal >= 25000 || subtotal === 0) ? 0 : 500;
    const grandTotal = Math.max(0, subtotal - discount + shipping);

    if (elements.checkoutItemPreviews) {
        if (state.cart.length === 0) {
            elements.checkoutItemPreviews.innerHTML = `
                <div style="font-size: 11px; color: var(--text-secondary); padding: 12px 0;">No items in bag.</div>
            `;
        } else {
            elements.checkoutItemPreviews.innerHTML = state.cart.map(item => `
                <div class="checkout-item-preview">
                    <img src="${item.variant.imageUrl}" alt="${item.product.fullName}">
                    <div class="checkout-item-meta">
                        <div class="item-title">${item.product.editorialTitle} • ${item.variant.colorName}</div>
                        <div class="item-qty-price">Qty: ${item.quantity} × ₹${item.product.priceInr.toLocaleString('en-IN')} = ₹${(item.product.priceInr * item.quantity).toLocaleString('en-IN')}</div>
                    </div>
                </div>
            `).join('');
        }
    }

    if (elements.summarySubtotal) {
        elements.summarySubtotal.textContent = `₹${subtotal.toLocaleString('en-IN')}`;
    }

    if (elements.summaryDiscountRow) {
        if (discount > 0) {
            elements.summaryDiscountRow.style.display = 'flex';
            if (elements.summaryPromoLabel) elements.summaryPromoLabel.textContent = state.appliedPromoCode;
            if (elements.summaryDiscount) elements.summaryDiscount.textContent = `-₹${discount.toLocaleString('en-IN')}`;
        } else {
            elements.summaryDiscountRow.style.display = 'none';
        }
    }

    if (elements.summaryShipping) {
        elements.summaryShipping.textContent = shipping === 0 ? 'FREE' : `₹${shipping}`;
    }

    if (elements.summaryGrandTotal) {
        elements.summaryGrandTotal.textContent = `₹${grandTotal.toLocaleString('en-IN')}`;
    }

    if (elements.placeOrderBtnText) {
        elements.placeOrderBtnText.textContent = `PAY ₹${grandTotal.toLocaleString('en-IN')} & CONFIRM ORDER`;
    }
}

function applyCheckoutPromo() {
    const code = elements.checkoutPromoInput ? elements.checkoutPromoInput.value.trim().toUpperCase() : '';
    if (!elements.promoFeedback) return;

    if (code === 'FIRST10') {
        state.appliedPromoCode = 'FIRST10';
        localStorage.setItem('artpoure_promo_code', 'FIRST10');
        elements.promoFeedback.textContent = '10% FIRST ORDER PRIVILEGE APPLIED';
        elements.promoFeedback.className = 'promo-feedback success';
        elements.promoFeedback.style.display = 'block';
        renderCheckoutSummary();
    } else if (!code) {
        state.appliedPromoCode = null;
        localStorage.removeItem('artpoure_promo_code');
        elements.promoFeedback.style.display = 'none';
        renderCheckoutSummary();
    } else {
        elements.promoFeedback.textContent = 'INVALID PROMO VOUCHER CODE (Use "FIRST10")';
        elements.promoFeedback.className = 'promo-feedback error';
        elements.promoFeedback.style.display = 'block';
    }
}

const RAZORPAY_KEY_ID = "rzp_live_U24HQteyWphATZ";

function selectPaymentMethod(method) {
    if (method === 'COD') {
        state.selectedPaymentMethod = 'COD';
        if (elements.payOptionCod) elements.payOptionCod.classList.add('active');
        if (elements.payOptionUpi) elements.payOptionUpi.classList.remove('active');
    } else {
        state.selectedPaymentMethod = 'RAZORPAY';
        if (elements.payOptionUpi) elements.payOptionUpi.classList.add('active');
        if (elements.payOptionCod) elements.payOptionCod.classList.remove('active');
    }
}

function restorePlaceOrderBtn(grandTotal) {
    if (elements.placeOrderBtn) {
        elements.placeOrderBtn.disabled = false;
        elements.placeOrderBtn.style.opacity = '1';
        elements.placeOrderBtn.style.cursor = 'pointer';
    }
    if (elements.placeOrderBtnText) {
        const total = grandTotal !== undefined ? grandTotal : state.cart.reduce((sum, item) => sum + (item.product.priceInr * item.quantity), 0);
        elements.placeOrderBtnText.textContent = `PAY ₹${total.toLocaleString('en-IN')} & CONFIRM ORDER`;
    }
}

function setPlaceOrderBtnLoading(text) {
    if (elements.placeOrderBtn) {
        elements.placeOrderBtn.disabled = true;
        elements.placeOrderBtn.style.opacity = '0.7';
        elements.placeOrderBtn.style.cursor = 'not-allowed';
    }
    if (elements.placeOrderBtnText) {
        elements.placeOrderBtnText.textContent = text || "INITIALIZING SECURE CHECKOUT...";
    }
}

function handleOrderSuccessDisplay(orderId, paymentMethod, grandTotal, receiverName, receiverPhone, addressObj) {
    const orderPayload = {
        orderId,
        items: state.cart.map(i => ({
            productId: i.product.id,
            title: i.product.editorialTitle,
            variant: i.variant.colorName,
            quantity: i.quantity,
            priceInr: i.product.priceInr,
            totalInr: i.product.priceInr * i.quantity
        })),
        pricing: {
            grandTotal,
            promoCode: state.appliedPromoCode || null
        },
        shippingAddress: {
            receiverName,
            receiverPhone,
            houseFlat: addressObj.houseFlat,
            floor: addressObj.floor,
            street: addressObj.street,
            area: addressObj.area,
            city: addressObj.city,
            pinCode: addressObj.pinCode
        },
        paymentMethod,
        status: "CONFIRMED",
        createdAt: new Date().toISOString()
    };

    state.orders.unshift(orderPayload);
    localStorage.setItem('artpoure_orders', JSON.stringify(state.orders));
    renderOrdersList();

    if (elements.orderSuccessId) {
        elements.orderSuccessId.textContent = `ORDER #${orderId}`;
    }
    if (elements.orderSuccessMeta) {
        elements.orderSuccessMeta.innerHTML = `
            <div style="font-size: 13px; font-weight: 700; margin-bottom: 6px; color: var(--accent-gold);">
                DELIVERING TO: ${receiverName} (${receiverPhone})
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.5;">
                ${addressObj.fullDisplay}
            </div>
            <div style="margin-top: 10px; font-size: 12px; font-weight: 700; color: var(--text-primary);">
                TOTAL AMOUNT: ₹${grandTotal.toLocaleString('en-IN')} (${paymentMethod})
            </div>
        `;
    }
    if (elements.orderSuccessModal) {
        elements.orderSuccessModal.style.display = 'flex';
    }

    state.cart = [];
    state.appliedPromoCode = null;
    localStorage.removeItem('artpoure_cart');
    localStorage.removeItem('artpoure_promo_code');
    updateBadges();
    renderCartDrawer();
    restorePlaceOrderBtn(0);
}

async function validateAndPlaceOrder() {
    if (state.cart.length === 0) {
        alert("Your shopping bag is empty. Please add items before placing an order.");
        return;
    }

    const receiverName = elements.checkoutReceiverName ? elements.checkoutReceiverName.value.trim() : '';
    const receiverPhone = elements.checkoutReceiverPhone ? elements.checkoutReceiverPhone.value.trim() : '';
    const houseFlat = elements.checkoutHouseFlat ? elements.checkoutHouseFlat.value.trim() : '';
    const floor = elements.checkoutFloor ? elements.checkoutFloor.value.trim() : '';
    const street = elements.checkoutStreet ? elements.checkoutStreet.value.trim() : '';
    const area = elements.checkoutArea ? elements.checkoutArea.value.trim() : '';
    const city = elements.checkoutCity ? elements.checkoutCity.value.trim() : '';
    const pinCode = elements.checkoutPinCode ? elements.checkoutPinCode.value.trim() : '';

    let isValid = true;
    let firstInvalid = null;

    if (!receiverName) {
        isValid = false;
        if (elements.errReceiverName) elements.errReceiverName.style.display = 'block';
        if (elements.checkoutReceiverName) elements.checkoutReceiverName.classList.add('input-invalid');
        if (!firstInvalid) firstInvalid = elements.checkoutReceiverName;
    } else {
        if (elements.errReceiverName) elements.errReceiverName.style.display = 'none';
        if (elements.checkoutReceiverName) elements.checkoutReceiverName.classList.remove('input-invalid');
    }

    if (!receiverPhone || !/^\d{10}$/.test(receiverPhone)) {
        isValid = false;
        if (elements.errReceiverPhone) elements.errReceiverPhone.style.display = 'block';
        if (elements.checkoutReceiverPhone) elements.checkoutReceiverPhone.classList.add('input-invalid');
        if (!firstInvalid) firstInvalid = elements.checkoutReceiverPhone;
    } else {
        if (elements.errReceiverPhone) elements.errReceiverPhone.style.display = 'none';
        if (elements.checkoutReceiverPhone) elements.checkoutReceiverPhone.classList.remove('input-invalid');
    }

    if (!houseFlat) {
        isValid = false;
        if (elements.errHouseFlat) elements.errHouseFlat.style.display = 'block';
        if (elements.checkoutHouseFlat) elements.checkoutHouseFlat.classList.add('input-invalid');
        if (!firstInvalid) firstInvalid = elements.checkoutHouseFlat;
    } else {
        if (elements.errHouseFlat) elements.errHouseFlat.style.display = 'none';
        if (elements.checkoutHouseFlat) elements.checkoutHouseFlat.classList.remove('input-invalid');
    }

    if (!street) {
        isValid = false;
        if (elements.errStreet) elements.errStreet.style.display = 'block';
        if (elements.checkoutStreet) elements.checkoutStreet.classList.add('input-invalid');
        if (!firstInvalid) firstInvalid = elements.checkoutStreet;
    } else {
        if (elements.errStreet) elements.errStreet.style.display = 'none';
        if (elements.checkoutStreet) elements.checkoutStreet.classList.remove('input-invalid');
    }

    if (!area) {
        isValid = false;
        if (elements.errArea) elements.errArea.style.display = 'block';
        if (elements.checkoutArea) elements.checkoutArea.classList.add('input-invalid');
        if (!firstInvalid) firstInvalid = elements.checkoutArea;
    } else {
        if (elements.errArea) elements.errArea.style.display = 'none';
        if (elements.checkoutArea) elements.checkoutArea.classList.remove('input-invalid');
    }

    if (!city) {
        isValid = false;
        if (elements.errCity) elements.errCity.style.display = 'block';
        if (elements.checkoutCity) elements.checkoutCity.classList.add('input-invalid');
        if (!firstInvalid) firstInvalid = elements.checkoutCity;
    } else {
        if (elements.errCity) elements.errCity.style.display = 'none';
        if (elements.checkoutCity) elements.checkoutCity.classList.remove('input-invalid');
    }

    if (!pinCode || !/^\d{6}$/.test(pinCode)) {
        isValid = false;
        if (elements.errPinCode) elements.errPinCode.style.display = 'block';
        if (elements.checkoutPinCode) elements.checkoutPinCode.classList.add('input-invalid');
        if (!firstInvalid) firstInvalid = elements.checkoutPinCode;
    } else {
        if (elements.errPinCode) elements.errPinCode.style.display = 'none';
        if (elements.checkoutPinCode) elements.checkoutPinCode.classList.remove('input-invalid');
    }

    if (!isValid) {
        if (firstInvalid) {
            firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            firstInvalid.focus();
        }
        return;
    }

    localStorage.setItem('user_profile_name', receiverName);
    localStorage.setItem('user_profile_phone', receiverPhone);
    const updatedAddrObj = {
        id: 'addr_checkout',
        label: 'Order Address',
        houseFlat, floor, street, area, city, pinCode,
        fullDisplay: `${houseFlat}${floor ? ', ' + floor : ''}, ${street}, ${area}, ${city} - ${pinCode}`,
        isGps: false
    };
    state.deliveryAddress = updatedAddrObj;
    localStorage.setItem('artpoure_delivery_address', JSON.stringify(updatedAddrObj));
    updateCurrentAddressDisplay();

    const subtotal = state.cart.reduce((sum, item) => sum + (item.product.priceInr * item.quantity), 0);
    const discount = state.appliedPromoCode === 'FIRST10' ? Math.round(subtotal * 0.10) : 0;
    const shipping = (subtotal >= 25000 || subtotal === 0) ? 0 : 500;
    const grandTotal = Math.max(0, subtotal - discount + shipping);

    // If Cash on Delivery is selected
    if (state.selectedPaymentMethod === 'COD') {
        setPlaceOrderBtnLoading("CONFIRMING CASH ON DELIVERY...");
        try {
            await ensureAuthSession();
            const createCodCallable = httpsCallable(functions, "createCodOrder");
            const codRes = await createCodCallable({
                items: state.cart.map(i => ({
                    productId: i.product.id,
                    quantity: i.quantity,
                    variant: i.variant.colorName
                })),
                shippingAddress: {
                    receiverName,
                    receiverPhone,
                    houseFlat,
                    floor,
                    street,
                    area,
                    city,
                    pinCode
                },
                promoCode: state.appliedPromoCode || null
            });

            const { firestoreOrderId, pricing } = codRes.data || {};
            const finalTotal = (pricing && pricing.grandTotal) ? pricing.grandTotal : grandTotal;
            handleOrderSuccessDisplay(firestoreOrderId, "Insured COD", finalTotal, receiverName, receiverPhone, updatedAddrObj);
        } catch (err) {
            console.error("COD order creation error:", err);
            alert(`Failed to place Cash on Delivery order: ${err.message || err}. Please try again.`);
            updatePlaceOrderBtnText(grandTotal);
        }
        return;
    }

    // ── RAZORPAY LIVE CHECKOUT FLOW ──
    if (typeof window.Razorpay !== 'function') {
        alert("Razorpay Standard Checkout SDK is loading or blocked by an adblocker. Please disable your adblocker and refresh.");
        return;
    }

    setPlaceOrderBtnLoading("INITIALIZING LIVE GATEWAY...");

    try {
        await ensureAuthSession();
        const createOrderCallable = httpsCallable(functions, "createRazorpayOrder");
        const orderRes = await createOrderCallable({
            items: state.cart.map(i => ({
                productId: i.product.id,
                quantity: i.quantity,
                variant: i.variant.colorName
            })),
            shippingAddress: {
                receiverName,
                receiverPhone,
                houseFlat,
                floor,
                street,
                area,
                city,
                pinCode
            },
            promoCode: state.appliedPromoCode || null
        });

        const { razorpayOrderId, amount, currency, firestoreOrderId } = orderRes.data;

        const options = {
            key: RAZORPAY_KEY_ID,
            amount: amount,
            currency: currency || "INR",
            name: "Artpoure",
            description: `Haute Ethnic Commission #${firestoreOrderId}`,
            order_id: razorpayOrderId,
            theme: {
                color: "#5C4033"
            },
            prefill: {
                name: receiverName,
                contact: receiverPhone,
                email: (auth.currentUser && auth.currentUser.email) || "patron@artpoure.in"
            },
            retry: {
                enabled: true,
                max_count: 2
            },
            handler: async function (response) {
                setPlaceOrderBtnLoading("VERIFYING PAYMENT INTEGRITY...");
                try {
                    const verifyCallable = httpsCallable(functions, "verifyRazorpayPayment");
                    const verifyRes = await verifyCallable({
                        razorpayOrderId: response.razorpay_order_id,
                        razorpayPaymentId: response.razorpay_payment_id,
                        razorpaySignature: response.razorpay_signature,
                        firestoreOrderId: firestoreOrderId
                    });

                    if (verifyRes.data && verifyRes.data.success) {
                        handleOrderSuccessDisplay(
                            firestoreOrderId,
                            `Razorpay Live (${response.razorpay_payment_id})`,
                            grandTotal,
                            receiverName,
                            receiverPhone,
                            updatedAddrObj
                        );
                    } else {
                        alert("Payment signature verification failed. Please contact support.");
                        restorePlaceOrderBtn(grandTotal);
                    }
                } catch (verifyErr) {
                    console.error("Signature verification error:", verifyErr);
                    alert("Payment received but signature verification timed out. Ref ID: " + response.razorpay_payment_id);
                    restorePlaceOrderBtn(grandTotal);
                }
            },
            modal: {
                ondismiss: function () {
                    console.log("Customer closed Razorpay modal.");
                    restorePlaceOrderBtn(grandTotal);
                }
            }
        };

        const rzp = new window.Razorpay(options);
        rzp.on("payment.failed", function (failResponse) {
            console.error("Razorpay payment error:", failResponse.error);
            alert("Payment Failed: " + (failResponse.error?.description || "Transaction declined by bank/network."));
            restorePlaceOrderBtn(grandTotal);
        });
        rzp.open();

    } catch (createErr) {
        console.error("Order creation error:", createErr);
        alert("Failed to initiate live checkout: " + (createErr.message || "Please check connection."));
        restorePlaceOrderBtn(grandTotal);
    }
}

// --- RENDER ARTCLUSIVE VAULT PIECES ---
function renderVaultPieces() {
    if (!elements.vaultGrid) return;
    const vaultItems = state.products.filter(p => ["saree-01", "saree-02", "jewel-02", "clothes-01"].includes(p.id));
    elements.vaultGrid.innerHTML = vaultItems.map(item => {
        const variant = item.variants[0];
        return `
            <div class="vault-card">
                <div class="vault-card-img-wrap" style="background-color: ${variant.canvasHex || '#2A2825'};">
                    <span class="vault-tag">VAULT PIECE</span>
                    <img src="${variant.imageUrl || item.imageUrl}" class="vault-card-img" alt="${item.fullName}">
                </div>
                <div class="vault-card-info">
                    <div>
                        <h3 class="vault-card-title">${item.editorialTitle}</h3>
                        <p class="vault-card-sub">${item.fullName}</p>
                    </div>
                    <div class="vault-card-bottom">
                        <span class="vault-card-price">₹${item.priceInr.toLocaleString('en-IN')}</span>
                        <button class="vault-reserve-btn" data-reserve-id="${item.id}">RESERVE</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    elements.vaultGrid.querySelectorAll('.vault-reserve-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.reserveId;
            addToCart(id);
        });
    });
}

// --- STARBURST SUPERNOVA TRANSITION ENGINE (2000ms Firecracker Engine) ---
let isStarburstActive = false;

function triggerStarburstTransition(buttonRect, onPeak) {
    if (isStarburstActive) return;
    const canvas = elements.starburstCanvas;
    if (!canvas) {
        if (onPeak) onPeak();
        return;
    }

    isStarburstActive = true;
    canvas.classList.add('active');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const startX = buttonRect.left + buttonRect.width / 2;
    const startY = buttonRect.top + buttonRect.height / 2;
    const epicenterX = width / 2;
    const epicenterY = height * 0.42;

    const goldPalette = [
        '#FFFDF2', // Diamond Sparkle White-Gold
        '#FFF1A8', // Radiant Light Gold
        '#F7D974', // Imperial Gold
        '#D4AF37', // Pure Metallic 24k Gold
        '#E5C07B', // Royal Rajputana Gold
        '#B38F28'  // Deep Antique Amber Gold
    ];

    // 64 Staggered Launch Stars in a wide, spaced-out fan across 85% of screen width
    const launchStars = [];
    for (let i = 0; i < 64; i++) {
        const baseSpread = -0.42 + (i / 63) * 0.84;
        const fanSpread = Math.min(0.44, Math.max(-0.44, baseSpread + (Math.random() - 0.5) * 0.04));
        const outwardSign = fanSpread >= 0 ? 1 : -1;

        launchStars.push({
            ignitionDelay: Math.random() * 0.16,
            fanSpreadFraction: fanSpread,
            targetAltitudeFraction: 0.22 + Math.random() * 0.28,
            size: 10 + Math.random() * 18,
            rotationSpeed: (Math.random() - 0.5) * 9.42,
            baseRotation: Math.random() * Math.PI * 2,
            color: goldPalette[i % goldPalette.length],
            arcCurveX: outwardSign * (25 + Math.random() * 65)
        });
    }

    // 88 Radial Supernova Fireworks Sparks stratified across 3 depth tiers
    const burstSparks = [];
    for (let i = 0; i < 88; i++) {
        const angle = (i / 88) * Math.PI * 2 + (Math.random() - 0.5) * 0.22;
        let speedTier;
        if (i % 3 === 0) {
            speedTier = 220 + Math.random() * 180;
        } else if (i % 3 === 1) {
            speedTier = 420 + Math.random() * 220;
        } else {
            speedTier = 660 + Math.random() * 300;
        }

        burstSparks.push({
            angle: angle,
            speed: speedTier,
            gravity: 240 + Math.random() * 200,
            size: 6 + Math.random() * 13,
            rotationSpeed: (Math.random() - 0.5) * 12.56,
            baseRotation: Math.random() * Math.PI * 2,
            color: goldPalette[i % goldPalette.length],
            twinkleFrequency: 3 + Math.random() * 4
        });
    }

    const duration = 2000; // Expanded to 2000ms for slow-motion cinematic majesty
    const startTime = performance.now();
    let peakFired = false;

    function render(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        ctx.clearRect(0, 0, width, height);

        // Theatrical Backdrop Dimming (Progressive Obsidian Night-Sky Curtain)
        let backdropDimAlpha = 0;
        if (progress < 0.28) {
            backdropDimAlpha = (progress / 0.28) * 0.82;
        } else if (progress < 0.52) {
            backdropDimAlpha = 0.82;
        } else {
            backdropDimAlpha = Math.max(0, (1 - (progress - 0.52) / 0.36) * 0.82);
        }
        if (backdropDimAlpha > 0.005) {
            ctx.fillStyle = `rgba(7, 6, 5, ${backdropDimAlpha})`;
            ctx.fillRect(0, 0, width, height);
        }

        // Detonation peak trigger at t = 0.425 (~850ms) to unveil ArtClusive page under veil
        if (progress >= 0.425 && !peakFired) {
            peakFired = true;
            if (onPeak) onPeak();
        }

        // Phase 1: Spaced-Out Firecracker Fountain Ascent (progress 0.0 -> 0.52)
        if (progress < 0.52) {
            launchStars.forEach(star => {
                if (progress >= star.ignitionDelay) {
                    const rawT = Math.min(1, Math.max(0, (progress - star.ignitionDelay) / (0.44 - star.ignitionDelay)));
                    // Decelerating upward ascent (Ease-Out Quadratic)
                    const starT = 1 - (1 - rawT) * (1 - rawT);

                    let starAlpha = 1;
                    if (rawT < 0.15) {
                        starAlpha = rawT / 0.15;
                    } else if (rawT > 0.75) {
                        starAlpha = Math.max(0, 1 - (rawT - 0.75) / 0.25);
                    }

                    const targetX = width * (0.5 + star.fanSpreadFraction);
                    const targetY = height * star.targetAltitudeFraction;

                    const currentX = startX + (targetX - startX) * starT + Math.sin(starT * Math.PI) * star.arcCurveX;
                    const currentY = startY + (targetY - startY) * starT;

                    // Draw 2 glowing trail spark dots behind rocket star
                    if (rawT >= 0.1 && rawT <= 0.85 && starAlpha > 0.2) {
                        const trail1T = Math.max(0, starT - 0.05);
                        const trail2T = Math.max(0, starT - 0.10);

                        const trail1X = startX + (targetX - startX) * trail1T;
                        const trail1Y = startY + (targetY - startY) * trail1T;
                        ctx.fillStyle = star.color;
                        ctx.globalAlpha = starAlpha * 0.45;
                        ctx.beginPath();
                        ctx.arc(trail1X, trail1Y, star.size * 0.28, 0, Math.PI * 2);
                        ctx.fill();

                        const trail2X = startX + (targetX - startX) * trail2T;
                        const trail2Y = startY + (targetY - startY) * trail2T;
                        ctx.globalAlpha = starAlpha * 0.22;
                        ctx.beginPath();
                        ctx.arc(trail2X, trail2Y, star.size * 0.16, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.globalAlpha = 1.0;
                    }

                    const curSize = star.size * (0.85 + 0.45 * Math.sin(rawT * Math.PI));
                    const curRot = star.baseRotation + star.rotationSpeed * rawT;
                    draw4PointStar(ctx, currentX, currentY, curSize, curRot, star.color, starAlpha);
                }
            });
        }

        // Phase 2: Supernova Radial Starlight Veil & Shockwave (progress 0.38 -> 1.0)
        if (progress >= 0.38) {
            const burstProgress = Math.min(1, Math.max(0, (progress - 0.38) / 0.62));
            const maxRadius = Math.hypot(width, height) * 1.1;
            const curRadius = maxRadius * Math.sqrt(burstProgress);

            let veilAlpha = 0;
            if (burstProgress < 0.25) {
                veilAlpha = Math.min(burstProgress / 0.25, 0.94);
            } else {
                veilAlpha = Math.max(0, (1 - (burstProgress - 0.25) / 0.75) * 0.94);
            }

            if (veilAlpha > 0.01) {
                const grad = ctx.createRadialGradient(epicenterX, epicenterY, 0, epicenterX, epicenterY, curRadius);
                grad.addColorStop(0, `rgba(255, 253, 245, ${veilAlpha * 0.96})`);
                grad.addColorStop(0.25, `rgba(247, 217, 116, ${veilAlpha * 0.78})`);
                grad.addColorStop(0.55, `rgba(212, 175, 55, ${veilAlpha * 0.48})`);
                grad.addColorStop(0.85, `rgba(20, 19, 18, ${veilAlpha * 0.22})`);
                grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(epicenterX, epicenterY, curRadius, 0, Math.PI * 2);
                ctx.fill();
            }

            // Phase 3: 88 Radial Fireworks Sparks with Gravity & Twinkle (progress 0.42 -> 0.98)
            if (progress >= 0.42) {
                const sparkFraction = Math.min(1, Math.max(0, (progress - 0.42) / 0.56));
                const baseSparkAlpha = Math.max(0, 1 - sparkFraction);

                if (baseSparkAlpha > 0.01) {
                    burstSparks.forEach(spark => {
                        const distance = spark.speed * sparkFraction;
                        const dropGravity = spark.gravity * sparkFraction * sparkFraction;
                        const px = epicenterX + Math.cos(spark.angle) * distance;
                        const py = epicenterY + Math.sin(spark.angle) * distance + dropGravity;

                        const shimmer = 0.7 + 0.3 * Math.sin(sparkFraction * spark.twinkleFrequency * Math.PI);
                        const sparkAlpha = Math.min(1, Math.max(0, baseSparkAlpha * shimmer));
                        const pSize = spark.size * (1 - sparkFraction * 0.35);
                        const pRot = spark.baseRotation + spark.rotationSpeed * sparkFraction;

                        draw4PointStar(ctx, px, py, pSize, pRot, spark.color, sparkAlpha);
                    });
                }
            }
        }

        if (progress < 1) {
            requestAnimationFrame(render);
        } else {
            ctx.clearRect(0, 0, width, height);
            canvas.classList.remove('active');
            isStarburstActive = false;
        }
    }

    requestAnimationFrame(render);
}

function draw4PointStar(ctx, cx, cy, radius, rotation, color, alpha) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;

    const innerRadius = radius * 0.24;
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.quadraticCurveTo(0, -innerRadius, innerRadius, 0);
    ctx.lineTo(radius, 0);
    ctx.quadraticCurveTo(innerRadius, 0, 0, innerRadius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, innerRadius, -innerRadius, 0);
    ctx.lineTo(-radius, 0);
    ctx.quadraticCurveTo(-innerRadius, 0, 0, -innerRadius);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

// --- ORDER & CONSULTATION HISTORY CONTROLLER ---

function openHistoryModal(activeTab = 'appointments') {
    if (!elements.historyOverlay) return;
    elements.historyOverlay.classList.add('open');
    switchHistoryTab(activeTab);
    renderAppointmentsList();
    renderOrdersList();
}

function closeHistoryModal() {
    if (elements.historyOverlay) {
        elements.historyOverlay.classList.remove('open');
    }
}

function switchHistoryTab(tab) {
    if (tab === 'appointments') {
        if (elements.tabAppointmentsBtn) elements.tabAppointmentsBtn.classList.add('active');
        if (elements.tabOrdersBtn) elements.tabOrdersBtn.classList.remove('active');
        if (elements.tabAppointmentsContent) elements.tabAppointmentsContent.style.display = 'block';
        if (elements.tabOrdersContent) elements.tabOrdersContent.style.display = 'none';
    } else {
        if (elements.tabAppointmentsBtn) elements.tabAppointmentsBtn.classList.remove('active');
        if (elements.tabOrdersBtn) elements.tabOrdersBtn.classList.add('active');
        if (elements.tabAppointmentsContent) elements.tabAppointmentsContent.style.display = 'none';
        if (elements.tabOrdersContent) elements.tabOrdersContent.style.display = 'block';
    }
}

function renderAppointmentsList() {
    const list = document.getElementById('appointmentsList');
    if (!list) return;

    if (!state.appointments || state.appointments.length === 0) {
        list.innerHTML = `
            <div class="history-empty">
                <div class="history-empty-icon">📅</div>
                <h4>No Consultation Appointments</h4>
                <p>Book a bespoke 1-on-1 consultation with our Master Atelier to view your scheduled sessions here.</p>
            </div>
        `;
        return;
    }

    list.innerHTML = state.appointments.map(apt => {
        const isCancelled = apt.status === 'CANCELLED';
        const formattedDate = apt.preferredDate || 'Date Not Specified';
        return `
            <div class="history-card">
                <div class="history-card-top">
                    <span class="history-id">${apt.id}</span>
                    <span class="status-badge ${isCancelled ? 'cancelled' : 'confirmed'}">
                        ${apt.status}
                    </span>
                </div>
                <div class="history-card-date">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    <span>Consultation Date: <strong>${formattedDate}</strong></span>
                </div>
                <div class="history-card-detail">
                    <div><strong>Client:</strong> ${apt.clientName} (${apt.clientPhone})</div>
                    ${apt.preferredWeave ? `<div><strong>Preferred Weave:</strong> ${apt.preferredWeave}</div>` : ''}
                </div>
                <div class="history-card-actions">
                    <button class="cancel-apt-btn" ${isCancelled ? 'disabled' : ''} onclick="cancelConsultation('${apt.id}')">
                        ${isCancelled ? 'CANCELLED' : 'CANCEL APPOINTMENT'}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

window.cancelConsultation = async function(aptId) {
    if (!confirm(`Are you sure you want to cancel appointment ${aptId}?`)) return;
    const apt = state.appointments.find(a => a.id === aptId);
    if (apt) {
        apt.status = 'CANCELLED';
        localStorage.setItem('artpoure_appointments', JSON.stringify(state.appointments));
        try {
            await setDoc(doc(db, "appointments", aptId), { status: 'CANCELLED' }, { merge: true });
        } catch (e) {
            console.warn("Firestore cancel appointment fallback:", e);
        }
        renderAppointmentsList();
    }
};

function renderOrdersList() {
    const list = document.getElementById('ordersList');
    if (!list) return;

    if (!state.orders || state.orders.length === 0) {
        list.innerHTML = `
            <div class="history-empty">
                <div class="history-empty-icon">🛍️</div>
                <h4>No Orders Placed Yet</h4>
                <p>Explore our curated heritage pieces and place your first couture commission.</p>
            </div>
        `;
        return;
    }

    list.innerHTML = state.orders.map(order => {
        const formattedDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Recent';
        const itemsSummary = (order.items || []).map(i => `${i.quantity}x ${i.title} (${i.variant || 'Standard'})`).join(', ');
        const total = order.pricing ? order.pricing.grandTotal : 0;
        return `
            <div class="history-card">
                <div class="history-card-top">
                    <span class="history-id">${order.orderId}</span>
                    <span class="status-badge confirmed">${order.status || 'CONFIRMED'}</span>
                </div>
                <div class="history-card-date">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    <span>${formattedDate} • <strong>₹${Number(total).toLocaleString('en-IN')}</strong> (${order.paymentMethod || 'UPI'})</span>
                </div>
                <div class="history-card-detail">
                    <div><strong>Items:</strong> ${itemsSummary}</div>
                    ${order.shippingAddress ? `<div><strong>Shipped to:</strong> ${order.shippingAddress.receiverName}, ${order.shippingAddress.city} - ${order.shippingAddress.pinCode}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// --- DELIVERY LOCATION & SAVED ADDRESSES ENGINE (1:1 with Android SavedAddressesSheet.kt) ---

function updateCurrentAddressDisplay() {
    if (!elements.currentAddress) return;
    const addr = state.deliveryAddress;
    if (!addr) {
        elements.currentAddress.textContent = "289, Horamavu, Bengaluru";
        return;
    }
    const shortText = addr.fullDisplay || `${addr.area || addr.street || ''}, ${addr.city || 'Bengaluru'}`;
    elements.currentAddress.textContent = shortText;
    elements.currentAddress.title = shortText;
}

function openAddressModal() {
    if (!elements.addressModalOverlay) return;
    renderSavedAddressesList();
    updateGpsIndicator();
    if (elements.newAddressForm) elements.newAddressForm.style.display = 'none';
    if (elements.toggleAddAddressBtn) elements.toggleAddAddressBtn.textContent = '+ ADD NEW';
    elements.addressModalOverlay.classList.add('open');
}

function closeAddressModal() {
    if (!elements.addressModalOverlay) return;
    elements.addressModalOverlay.classList.remove('open');
}

function updateGpsIndicator() {
    const isGps = state.deliveryAddress && state.deliveryAddress.isGps;
    if (elements.gpsActiveBadge) elements.gpsActiveBadge.style.display = isGps ? 'inline-block' : 'none';
    if (elements.gpsIconBubble) {
        if (isGps) elements.gpsIconBubble.classList.add('active');
        else elements.gpsIconBubble.classList.remove('active');
    }
    if (elements.gpsStatusText) {
        elements.gpsStatusText.textContent = isGps
            ? `Active: ${state.deliveryAddress.fullDisplay}`
            : 'Detect live geolocation using device GPS';
    }
}

function selectDeliveryAddress(addr) {
    state.deliveryAddress = addr;
    localStorage.setItem('artpoure_delivery_address', JSON.stringify(addr));
    updateCurrentAddressDisplay();
    updateGpsIndicator();

    // Sync to checkout inputs if user navigates to checkout
    if (elements.checkoutHouseFlat && addr.houseFlat) elements.checkoutHouseFlat.value = addr.houseFlat;
    if (elements.checkoutFloor && addr.floor) elements.checkoutFloor.value = addr.floor;
    if (elements.checkoutStreet && addr.street) elements.checkoutStreet.value = addr.street;
    if (elements.checkoutArea && addr.area) elements.checkoutArea.value = addr.area;
    if (elements.checkoutCity && addr.city) elements.checkoutCity.value = addr.city;
    if (elements.checkoutPinCode && addr.pinCode) elements.checkoutPinCode.value = addr.pinCode;

    renderSavedAddressesList();
    setTimeout(() => {
        closeAddressModal();
    }, 250);
}

function renderSavedAddressesList() {
    if (!elements.savedAddressesList) return;
    const currentId = state.deliveryAddress ? (state.deliveryAddress.id || state.deliveryAddress.fullDisplay) : null;

    elements.savedAddressesList.innerHTML = state.savedAddresses.map(addr => {
        const isSelected = (!state.deliveryAddress?.isGps) && (addr.id === currentId || addr.fullDisplay === state.deliveryAddress?.fullDisplay);
        return `
            <div class="saved-address-card ${isSelected ? 'selected' : ''}" data-addr-id="${addr.id}">
                <div class="saved-addr-left">
                    <div class="saved-addr-top">
                        <span class="saved-addr-label">${addr.label.toUpperCase()}</span>
                        ${isSelected ? '<span class="saved-addr-tag-active">ACTIVE POINT</span>' : ''}
                    </div>
                    <div class="saved-addr-text">${addr.fullDisplay}</div>
                    <div class="saved-addr-sub">${addr.city} • Pincode: ${addr.pinCode}</div>
                </div>
                <div class="saved-addr-radio"></div>
            </div>
        `;
    }).join('');

    elements.savedAddressesList.querySelectorAll('.saved-address-card').forEach(card => {
        card.addEventListener('click', () => {
            const addrId = card.getAttribute('data-addr-id');
            const found = state.savedAddresses.find(a => a.id === addrId);
            if (found) {
                selectDeliveryAddress({ ...found, isGps: false });
            }
        });
    });
}

function saveNewCustomAddress() {
    const label = (elements.newAddrLabel?.value.trim()) || 'Studio';
    const house = elements.newAddrHouse?.value.trim() || '';
    const street = elements.newAddrStreet?.value.trim() || '';
    const area = elements.newAddrArea?.value.trim() || '';
    const city = elements.newAddrCity?.value.trim() || 'Bengaluru';
    const pin = elements.newAddrPin?.value.trim() || '';

    if (!house || !street || !area || !pin) {
        alert("Please complete House/Flat, Street, Area and 6-digit Pincode.");
        return;
    }

    const newId = `addr_custom_${Date.now()}`;
    const fullDisplay = `${house}, ${street}, ${area}, ${city} - ${pin}`;
    const newAddr = {
        id: newId,
        label,
        houseFlat: house,
        street,
        area,
        city,
        pinCode: pin,
        fullDisplay,
        isGps: false
    };

    state.savedAddresses.push(newAddr);
    localStorage.setItem('artpoure_saved_address_list', JSON.stringify(state.savedAddresses));
    selectDeliveryAddress(newAddr);
}

function useCurrentLocation() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser. Please choose from saved addresses.");
        return;
    }

    if (elements.gpsStatusText) elements.gpsStatusText.textContent = "Acquiring live GPS satellite coordinates...";
    if (elements.gpsIconBubble) elements.gpsIconBubble.classList.add('active');

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            try {
                // Reverse geocoding via OpenStreetMap Nominatim
                const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
                if (res.ok) {
                    const data = await res.json();
                    const addr = data.address || {};
                    const area = addr.suburb || addr.neighbourhood || addr.residential || addr.city_district || "Outer Ring Road";
                    const city = addr.city || addr.town || addr.county || "Bengaluru";
                    const pin = addr.postcode || "560043";
                    const street = addr.road || "Main Road";
                    const house = addr.house_number || "Plot 289";
                    const liveAddr = {
                        id: 'addr_gps_live',
                        label: 'Live GPS',
                        houseFlat: house,
                        street,
                        area,
                        city,
                        pinCode: pin,
                        fullDisplay: `${area}, ${city} - ${pin}`,
                        isGps: true,
                        latitude: lat,
                        longitude: lng
                    };
                    selectDeliveryAddress(liveAddr);
                    return;
                }
            } catch (err) {
                console.warn("Reverse geocode network fallback:", err);
            }

            // Fallback coordinate representation
            const fallbackGpsAddr = {
                id: 'addr_gps_live',
                label: 'Current Location',
                houseFlat: 'Live Coordinate',
                street: `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`,
                area: 'Bengaluru Urban',
                city: 'Bengaluru',
                pinCode: '560001',
                fullDisplay: `Bengaluru (${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E)`,
                isGps: true,
                latitude: lat,
                longitude: lng
            };
            selectDeliveryAddress(fallbackGpsAddr);
        },
        (error) => {
            console.warn("Geolocation error:", error);
            if (elements.gpsStatusText) {
                elements.gpsStatusText.textContent = "Location permission denied. Please select a saved address.";
            }
            if (elements.gpsIconBubble) elements.gpsIconBubble.classList.remove('active');
            setTimeout(() => {
                if (elements.gpsStatusText) elements.gpsStatusText.textContent = "Detect live geolocation using device GPS";
            }, 3500);
        },
        { timeout: 10000, enableHighAccuracy: true }
    );
}

/**
 * Helper to generate verified Razorpay bespoke payment link for custom commissions outside cart
 */
export function generateBespokePaymentLink(amount) {
    const validAmount = Math.max(1, Math.round(Number(amount) || 5000));
    return `https://razorpay.me/@shibmalyaananya/${validAmount}`;
}
window.generateBespokePaymentLink = generateBespokePaymentLink;

// Boot application
document.addEventListener('DOMContentLoaded', init);
