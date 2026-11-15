/**
 * ARTPOURE • HAUTE ETHNIC EDITORIAL WEB APPLICATION
 * Modular ES6 implementation matching Android Jetpack Compose Architecture
 */

import {
    auth,
    db,
    collection,
    getDocs,
    doc,
    setDoc,
    getDoc,
    onAuthStateChanged
} from './firebase-config.js';

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
    theme: localStorage.getItem('artpoure_theme') || 'light'
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
    collectionTab: document.getElementById('collectionTab'),
    closeCartBtn: document.getElementById('closeCartBtn'),
    cartItemsList: document.getElementById('cartItemsList'),
    cartTotalSum: document.getElementById('cartTotalSum')
};

// --- INITIALIZATION ---
async function init() {
    applyTheme(state.theme);
    setupScrollPhysics();
    setupEventListeners();
    await fetchCatalog();
    setupHeroShowcase();
    renderCatalog();
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

// --- THEME SWITCHER (Light / Dark Mode) ---
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('artpoure_theme', theme);
    state.theme = theme;
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

    // Bottom Navigation
    elements.collectionTab.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    elements.cartTab.addEventListener('click', () => {
        openCartDrawer();
    });

    elements.closeCartBtn.addEventListener('click', () => {
        closeCartDrawer();
    });

    elements.cartDrawerOverlay.addEventListener('click', (e) => {
        if (e.target === elements.cartDrawerOverlay) {
            closeCartDrawer();
        }
    });
}

// Boot application
document.addEventListener('DOMContentLoaded', init);
