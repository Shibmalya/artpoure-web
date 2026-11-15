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
    starburstCanvas: document.getElementById('starburstCanvas')
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

    // Bottom Navigation switching between Collection & ArtClusive
    elements.collectionTab.addEventListener('click', () => {
        elements.collectionTab.classList.add('active');
        if (elements.artclusiveTab) elements.artclusiveTab.classList.remove('active');
        if (elements.mainContent) elements.mainContent.style.display = 'block';
        if (elements.artclusivePage) elements.artclusivePage.style.display = 'none';
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
                renderVaultPieces();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });
    }

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

    // Consultation Modal
    if (elements.openConsultationBtn && elements.consultationOverlay) {
        elements.openConsultationBtn.addEventListener('click', () => {
            elements.consultationOverlay.classList.add('open');
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
    if (elements.submitConsultationBtn && elements.consultationOverlay) {
        elements.submitConsultationBtn.addEventListener('click', () => {
            elements.consultationOverlay.classList.remove('open');
            alert('Consultation Confirmed! Our Master Atelier Concierge will connect with you shortly.');
        });
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

    // 64 Staggered Launch Stars (Firecracker Fountain)
    const launchStars = [];
    for (let i = 0; i < 64; i++) {
        launchStars.push({
            ignitionDelay: Math.random() * 0.16,
            targetOffsetX: (Math.random() - 0.5) * 220,
            size: 10 + Math.random() * 18,
            rotationSpeed: (Math.random() - 0.5) * 9.42,
            baseRotation: Math.random() * Math.PI * 2,
            color: goldPalette[i % goldPalette.length],
            arcCurveX: (Math.random() - 0.5) * 80
        });
    }

    // 88 Radial Supernova Fireworks Sparks with Gravity
    const burstSparks = [];
    for (let i = 0; i < 88; i++) {
        const angle = (i / 88) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
        burstSparks.push({
            angle: angle,
            speed: 280 + Math.random() * 680,
            gravity: 260 + Math.random() * 220,
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

        // Detonation peak trigger at t = 0.425 (~850ms) to unveil ArtClusive page under veil
        if (progress >= 0.425 && !peakFired) {
            peakFired = true;
            if (onPeak) onPeak();
        }

        // Phase 1: Firecracker Fountain Ascent (progress 0.0 -> 0.52)
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

                    const currentX = startX + (epicenterX + star.targetOffsetX - startX) * starT + Math.sin(starT * Math.PI) * star.arcCurveX;
                    const currentY = startY + (epicenterY - startY) * starT;

                    // Draw 2 glowing trail spark dots behind rocket star
                    if (rawT >= 0.1 && rawT <= 0.85 && starAlpha > 0.2) {
                        const trail1T = Math.max(0, starT - 0.05);
                        const trail2T = Math.max(0, starT - 0.10);

                        const trail1X = startX + (epicenterX + star.targetOffsetX - startX) * trail1T;
                        const trail1Y = startY + (epicenterY - startY) * trail1T;
                        ctx.fillStyle = star.color;
                        ctx.globalAlpha = starAlpha * 0.45;
                        ctx.beginPath();
                        ctx.arc(trail1X, trail1Y, star.size * 0.28, 0, Math.PI * 2);
                        ctx.fill();

                        const trail2X = startX + (epicenterX + star.targetOffsetX - startX) * trail2T;
                        const trail2Y = startY + (epicenterY - startY) * trail2T;
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

// Boot application
document.addEventListener('DOMContentLoaded', init);
