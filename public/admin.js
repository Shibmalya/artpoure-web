// =============================================================================
// ARTPOURE • PRIVATE ATELIER ADMIN PORTAL LOGIC
// Catalog manager with Firebase Storage uploads, Orders & Consultations
// =============================================================================

import {
    auth,
    db,
    storage,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    collection,
    getDocs,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    deleteDoc,
    query,
    orderBy,
    serverTimestamp,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from './firebase-config.js';

// Authorized Admin Emails (must match firestore.rules and storage.rules)
const ADMIN_EMAILS = [
    "artpoure@gmail.com",
    "artpoure.official@gmail.com",
    "admin@artpoure.in",
    "shibmalyaananya@gmail.com",
    "shibmalyada@gmail.com",
    "deyananya98@gmail.com"
];

// App State
const state = {
    user: null,
    products: [],
    orders: [],
    appointments: [],
    currentTab: 'products',
    editingProductId: null,
    productFilterCategory: 'ALL',
    productSearchQuery: '',
    orderFilterStatus: 'ALL',
    orderSearchQuery: '',
    consultationFilterStatus: 'ALL',
    consultationSearchQuery: '',
    variantCounter: 0,
    modalPendingAction: null
};

// DOM Elements
const el = {
    authGate: document.getElementById('authGate'),
    unauthorizedScreen: document.getElementById('unauthorizedScreen'),
    unauthorizedEmailDisplay: document.getElementById('unauthorizedEmailDisplay'),
    unauthorizedSignOutBtn: document.getElementById('unauthorizedSignOutBtn'),
    adminApp: document.getElementById('adminApp'),
    googleSignInBtn: document.getElementById('googleSignInBtn'),
    authErrorMsg: document.getElementById('authErrorMsg'),
    adminUserAvatar: document.getElementById('adminUserAvatar'),
    adminUserName: document.getElementById('adminUserName'),
    adminUserEmail: document.getElementById('adminUserEmail'),
    signOutBtn: document.getElementById('signOutBtn'),
    navTabs: document.querySelectorAll('.nav-tab-btn'),
    tabSections: document.querySelectorAll('.admin-tab-section'),
    productsCountBadge: document.getElementById('productsCountBadge'),
    ordersCountBadge: document.getElementById('ordersCountBadge'),
    consultationsCountBadge: document.getElementById('consultationsCountBadge'),

    // Products Tab
    toggleProductFormBtn: document.getElementById('toggleProductFormBtn'),
    toggleProductFormText: document.getElementById('toggleProductFormText'),
    productFormPanel: document.getElementById('productFormPanel'),
    closeProductFormBtn: document.getElementById('closeProductFormBtn'),
    formPanelTitle: document.getElementById('formPanelTitle'),
    productEditForm: document.getElementById('productEditForm'),
    cancelFormBtn: document.getElementById('cancelFormBtn'),
    variantsContainer: document.getElementById('variantsContainer'),
    addVariantBtn: document.getElementById('addVariantBtn'),
    formProgressFeedback: document.getElementById('formProgressFeedback'),
    formProgressMessage: document.getElementById('formProgressMessage'),
    saveProductBtn: document.getElementById('saveProductBtn'),
    productSearchInput: document.getElementById('productSearchInput'),
    productCategoryFilters: document.getElementById('productCategoryFilters'),
    productsLoadingSpinner: document.getElementById('productsLoadingSpinner'),
    productsEmptyState: document.getElementById('productsEmptyState'),
    productsGrid: document.getElementById('productsGrid'),

    // Orders Tab
    refreshOrdersBtn: document.getElementById('refreshOrdersBtn'),
    orderSearchInput: document.getElementById('orderSearchInput'),
    orderStatusFilters: document.getElementById('orderStatusFilters'),
    ordersLoadingSpinner: document.getElementById('ordersLoadingSpinner'),
    ordersEmptyState: document.getElementById('ordersEmptyState'),
    ordersList: document.getElementById('ordersList'),

    // Consultations Tab
    refreshConsultationsBtn: document.getElementById('refreshConsultationsBtn'),
    consultationSearchInput: document.getElementById('consultationSearchInput'),
    consultationStatusFilters: document.getElementById('consultationStatusFilters'),
    consultationsLoadingSpinner: document.getElementById('consultationsLoadingSpinner'),
    consultationsEmptyState: document.getElementById('consultationsEmptyState'),
    consultationsList: document.getElementById('consultationsList'),

    // Modal & Toast
    toastContainer: document.getElementById('toastContainer'),
    confirmModal: document.getElementById('confirmModal'),
    confirmModalTitle: document.getElementById('confirmModalTitle'),
    confirmModalMessage: document.getElementById('confirmModalMessage'),
    confirmModalCancelBtn: document.getElementById('confirmModalCancelBtn'),
    confirmModalProceedBtn: document.getElementById('confirmModalProceedBtn')
};

// =============================================================================
// TOAST NOTIFICATIONS
// =============================================================================
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : '✦';
    toast.innerHTML = `<span style="color: var(--gold);">${icon}</span> <span>${message}</span>`;
    el.toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// =============================================================================
// CONFIRMATION DIALOG MODAL
// =============================================================================
function showConfirmModal(title, message, onProceed) {
    el.confirmModalTitle.textContent = title;
    el.confirmModalMessage.textContent = message;
    state.modalPendingAction = onProceed;
    el.confirmModal.style.display = 'flex';
}

function hideConfirmModal() {
    el.confirmModal.style.display = 'none';
    state.modalPendingAction = null;
}

el.confirmModalCancelBtn.addEventListener('click', hideConfirmModal);
el.confirmModalProceedBtn.addEventListener('click', () => {
    if (typeof state.modalPendingAction === 'function') {
        state.modalPendingAction();
    }
    hideConfirmModal();
});

// =============================================================================
// AUTHENTICATION & ACCESS CONTROL
// =============================================================================
function checkAdminAuth(user) {
    if (!user) {
        el.authGate.style.display = 'flex';
        el.unauthorizedScreen.style.display = 'none';
        el.adminApp.style.display = 'none';
        return;
    }

    const email = (user.email || '').toLowerCase().trim();
    const isAllowed = ADMIN_EMAILS.some(allowed => allowed.toLowerCase().trim() === email);

    if (!isAllowed) {
        el.authGate.style.display = 'none';
        el.unauthorizedScreen.style.display = 'flex';
        el.unauthorizedEmailDisplay.textContent = `Signed in as: ${user.email}`;
        el.adminApp.style.display = 'none';
        return;
    }

    // Authorized Admin User
    state.user = user;
    el.authGate.style.display = 'none';
    el.unauthorizedScreen.style.display = 'none';
    el.adminApp.style.display = 'flex';

    el.adminUserName.textContent = user.displayName || 'Curator Admin';
    el.adminUserEmail.textContent = user.email;
    if (user.photoURL) {
        el.adminUserAvatar.src = user.photoURL;
        el.adminUserAvatar.style.display = 'block';
    }

    // Load initial data
    loadAllAdminData();
}

// Google Sign-In
el.googleSignInBtn.addEventListener('click', async () => {
    try {
        el.authErrorMsg.style.display = 'none';
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithPopup(auth, provider);
    } catch (err) {
        console.error("Google Sign-In Error:", err);
        el.authErrorMsg.textContent = `Authentication failed: ${err.message}`;
        el.authErrorMsg.style.display = 'block';
    }
});

// Sign-Out
function handleSignOut() {
    signOut(auth).then(() => {
        state.user = null;
        showToast("Signed out successfully", "info");
    }).catch(err => {
        showToast(`Sign out error: ${err.message}`, "error");
    });
}
el.signOutBtn.addEventListener('click', handleSignOut);
el.unauthorizedSignOutBtn.addEventListener('click', handleSignOut);

// Auth state observer
onAuthStateChanged(auth, user => {
    checkAdminAuth(user);
});

// =============================================================================
// TAB NAVIGATION
// =============================================================================
el.navTabs.forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        switchTab(tab);
    });
});

function switchTab(tabName) {
    state.currentTab = tabName;
    el.navTabs.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    el.tabSections.forEach(sec => {
        sec.classList.toggle('active', sec.id === `tab-${tabName}`);
    });
}

// =============================================================================
// LOAD ALL DATA
// =============================================================================
async function loadAllAdminData() {
    await Promise.all([
        fetchProducts(),
        fetchOrders(),
        fetchConsultations()
    ]);
}

// =============================================================================
// TAB 1: PRODUCTS (Catalog Manager)
// =============================================================================

async function fetchProducts() {
    el.productsLoadingSpinner.style.display = 'flex';
    el.productsEmptyState.style.display = 'none';
    el.productsGrid.innerHTML = '';

    try {
        const querySnapshot = await getDocs(collection(db, "products"));
        const items = [];
        querySnapshot.forEach(docSnap => {
            items.push({ id: docSnap.id, ...docSnap.data() });
        });
        state.products = items;
        el.productsCountBadge.textContent = items.length;
        renderProductsGrid();
    } catch (err) {
        console.error("Error fetching products:", err);
        showToast(`Could not load products: ${err.message}`, "error");
    } finally {
        el.productsLoadingSpinner.style.display = 'none';
    }
}

function renderProductsGrid() {
    const queryStr = state.productSearchQuery.toLowerCase().trim();
    const cat = state.productFilterCategory;

    const filtered = state.products.filter(p => {
        let matchesCategory = false;
        if (cat === 'ALL') {
            matchesCategory = true;
        } else if (cat === 'NEW_ARRIVALS') {
            matchesCategory = !!(p.inNewArrivals || p.isNewArrival);
        } else {
            matchesCategory = (p.category && p.category.toUpperCase() === cat);
        }

        const matchesSearch = !queryStr ||
            (p.fullName && p.fullName.toLowerCase().includes(queryStr)) ||
            (p.editorialTitle && p.editorialTitle.toLowerCase().includes(queryStr)) ||
            (p.id && p.id.toLowerCase().includes(queryStr));
        return matchesCategory && matchesSearch;
    });

    if (filtered.length === 0) {
        el.productsEmptyState.style.display = 'block';
        el.productsGrid.innerHTML = '';
        return;
    }

    el.productsEmptyState.style.display = 'none';
    el.productsGrid.innerHTML = filtered.map(prod => {
        const firstVariant = (prod.variants && prod.variants[0]) || {};
        const thumbnail = prod.imageUrl || firstVariant.imageUrl || 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=600&q=80';
        const variantsList = prod.variants || [];
        const formattedPrice = Number(prod.priceInr || 0).toLocaleString('en-IN');
        const isArrival = !!(prod.inNewArrivals || prod.isNewArrival);

        const variantDots = variantsList.map(v => {
            const swatch = v.swatchHex || '#1A1A1A';
            return `<span class="variant-dot" style="background-color: ${swatch};" title="${v.colorName || 'Variant'}"></span>`;
        }).join('');

        return `
            <div class="product-admin-card" data-product-id="${prod.id}">
                <div class="card-image-wrap">
                    <img src="${thumbnail}" alt="${prod.fullName || prod.id}" class="card-product-img" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=600&q=80'">
                    <span class="card-category-badge">${prod.category || 'HEIRLOOM'}</span>
                    ${isArrival ? '<span class="card-category-badge" style="top: 36px; background: rgba(184, 134, 11, 0.95); color: #fff;">✦ NEW ARRIVAL</span>' : ''}
                    <span class="card-price-badge">₹${formattedPrice}</span>
                </div>
                <div class="card-body">
                    <span class="card-editorial-title">${prod.editorialTitle || ''}</span>
                    <h4 class="card-full-name">${prod.fullName || prod.id}</h4>
                    <div class="card-variants-row">
                        ${variantDots}
                        <span class="variant-count-text">${variantsList.length} color${variantsList.length === 1 ? '' : 's'}</span>
                    </div>
                    <div class="card-actions-bar" style="display: flex; flex-wrap: wrap; gap: 6px;">
                        <button class="btn-card-action edit-prod-btn" data-id="${prod.id}">✎ Edit</button>
                        <button class="btn-card-action toggle-arrival-btn ${isArrival ? 'active' : ''}" data-id="${prod.id}" style="${isArrival ? 'background: #B8860B; color: #fff; font-weight: 600;' : 'border-color: #B8860B; color: #5C4033;'}">
                            ${isArrival ? '✓ In New Arrivals' : '+ New Arrival'}
                        </button>
                        <button class="btn-card-action danger delete-prod-btn" data-id="${prod.id}">✕</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Attach card action listeners
    el.productsGrid.querySelectorAll('.edit-prod-btn').forEach(btn => {
        btn.addEventListener('click', () => editProduct(btn.dataset.id));
    });
    el.productsGrid.querySelectorAll('.toggle-arrival-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const prod = state.products.find(p => p.id === id);
            if (!prod) return;
            const newStatus = !(prod.inNewArrivals || prod.isNewArrival);
            btn.disabled = true;
            btn.textContent = 'Updating...';
            try {
                await updateDoc(doc(db, "products", id), {
                    inNewArrivals: newStatus,
                    isNewArrival: newStatus,
                    updatedAt: serverTimestamp()
                });
                prod.inNewArrivals = newStatus;
                prod.isNewArrival = newStatus;
                showToast(`"${prod.fullName || id}" ${newStatus ? 'added to' : 'removed from'} New Arrivals!`, "success");
                renderProductsGrid();
            } catch (err) {
                console.error("Error updating New Arrivals status:", err);
                showToast(`Failed to update New Arrivals: ${err.message}`, "error");
                btn.disabled = false;
            }
        });
    });
    el.productsGrid.querySelectorAll('.delete-prod-btn').forEach(btn => {
        btn.addEventListener('click', () => confirmDeleteProduct(btn.dataset.id));
    });
}

// Product search and filter listeners
el.productSearchInput.addEventListener('input', e => {
    state.productSearchQuery = e.target.value;
    renderProductsGrid();
});

el.productCategoryFilters.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        el.productCategoryFilters.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.productFilterCategory = pill.dataset.category;
        renderProductsGrid();
    });
});

// Toggle Add/Edit Product Panel
function openProductForm(isEditing = false) {
    el.productFormPanel.style.display = 'block';
    el.formPanelTitle.textContent = isEditing ? `Edit Heirloom (${state.editingProductId})` : 'Create New Heirloom Piece';
    el.toggleProductFormText.textContent = 'Close Editor';
    el.productFormPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeProductForm() {
    el.productFormPanel.style.display = 'none';
    el.toggleProductFormText.textContent = 'New Product';
    state.editingProductId = null;
    el.productEditForm.reset();
    document.getElementById('prodId').disabled = false;
    el.variantsContainer.innerHTML = '';
}

el.toggleProductFormBtn.addEventListener('click', () => {
    if (el.productFormPanel.style.display === 'none') {
        initNewProductForm();
        openProductForm(false);
    } else {
        closeProductForm();
    }
});

el.closeProductFormBtn.addEventListener('click', closeProductForm);
el.cancelFormBtn.addEventListener('click', closeProductForm);

// Auto-slugify product ID on new product input
document.getElementById('prodEditorialTitle').addEventListener('input', e => {
    if (!state.editingProductId) {
        const idInput = document.getElementById('prodId');
        if (!idInput.value || idInput.dataset.autoSlugified === 'true') {
            const slug = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            if (slug) {
                idInput.value = `${slug}-${Date.now().toString().slice(-4)}`;
                idInput.dataset.autoSlugified = 'true';
            }
        }
    }
});

// Render thumbnail gallery for a variant card
function renderVariantGallery(card) {
    const galleryEl = card.querySelector('.variant-gallery-preview');
    if (!galleryEl) return;
    const images = card._variantImages || [];

    if (images.length === 0) {
        galleryEl.innerHTML = `
            <div class="variant-gallery-empty-prompt">
                <span style="font-size: 16px;">📷</span>
                <span>No photos added yet. Select one or more files below.</span>
            </div>
        `;
        return;
    }

    galleryEl.innerHTML = images.map((img, idx) => `
        <div class="variant-gallery-item" data-index="${idx}">
            <img src="${img.url || img.previewUrl}" alt="Photo ${idx + 1}">
            ${idx === 0 ? '<span class="primary-badge">Primary</span>' : ''}
            <button type="button" class="btn-remove-thumb" data-index="${idx}" title="Remove photo">✕</button>
        </div>
    `).join('');

    galleryEl.querySelectorAll('.btn-remove-thumb').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const removeIdx = parseInt(btn.dataset.index, 10);
            if (!isNaN(removeIdx) && card._variantImages) {
                card._variantImages.splice(removeIdx, 1);
                renderVariantGallery(card);
            }
        });
    });
}

// Dynamic Variants Builder with Multi-Photo Gallery Support
function createVariantCard(variantData = {}) {
    state.variantCounter++;
    const vId = variantData.id || `var-${state.variantCounter}`;
    const colorName = variantData.colorName || 'Royal Burgundy';
    const swatchHex = variantData.swatchHex || '#800020';
    const canvasHex = variantData.canvasHex || '#4A0E17';
    const inStock = variantData.inStock !== false;

    // Collect initial images array from variantData
    const initialImages = Array.isArray(variantData.images) && variantData.images.length > 0
        ? variantData.images
        : (variantData.imageUrl ? [variantData.imageUrl] : []);

    const card = document.createElement('div');
    card.className = 'variant-card';
    card.dataset.variantId = vId;
    card._variantImages = initialImages.filter(Boolean).map(url => ({
        type: 'existing',
        url: url
    }));

    card.innerHTML = `
        <div class="variant-card-top">
            <span class="variant-index-badge">VARIANT • ${vId.toUpperCase()}</span>
            <button type="button" class="btn-remove-variant">✕ Remove Variant</button>
        </div>
        <div class="variant-grid">
            <div class="form-field-group">
                <label>Color Name *</label>
                <input type="text" class="form-input variant-color-name" value="${colorName}" placeholder="e.g. Royal Burgundy" required>
            </div>
            <div class="form-field-group">
                <label>Swatch Hex</label>
                <div class="color-picker-group">
                    <input type="color" class="native-color-input variant-swatch-input" value="${swatchHex}">
                    <span class="color-hex-text variant-swatch-hex">${swatchHex}</span>
                </div>
            </div>
            <div class="form-field-group">
                <label>Canvas Tint Hex</label>
                <div class="color-picker-group">
                    <input type="color" class="native-color-input variant-canvas-input" value="${canvasHex}">
                    <span class="color-hex-text variant-canvas-hex">${canvasHex}</span>
                </div>
            </div>
            <div class="form-field-group" style="padding-bottom: 8px;">
                <label class="checkbox-label">
                    <input type="checkbox" class="variant-instock-check" ${inStock ? 'checked' : ''}>
                    <span>In Stock</span>
                </label>
            </div>
        </div>

        <div class="variant-photo-section">
            <label style="font-size: 11px; font-weight: 600; color: var(--gold); text-transform: uppercase; letter-spacing: 0.5px;">Photos for this Color Variant (First is Primary Card Photo)</label>
            <div class="variant-gallery-preview"></div>
            <div class="variant-photo-inputs">
                <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">Upload Photos (Select one or multiple files):</label>
                <input type="file" class="file-input-custom variant-file-input" accept="image/*" multiple>
                <div style="display: flex; gap: 8px; margin-top: 4px;">
                    <input type="url" class="form-input variant-add-url-input" placeholder="Or paste photo URL here...">
                    <button type="button" class="btn-secondary-action btn-sm variant-add-url-btn">+ Add URL</button>
                </div>
            </div>
        </div>
    `;

    renderVariantGallery(card);

    // Color picker change listeners
    const swatchInput = card.querySelector('.variant-swatch-input');
    const swatchHexSpan = card.querySelector('.variant-swatch-hex');
    swatchInput.addEventListener('input', e => {
        swatchHexSpan.textContent = e.target.value.toUpperCase();
    });

    const canvasInput = card.querySelector('.variant-canvas-input');
    const canvasHexSpan = card.querySelector('.variant-canvas-hex');
    canvasInput.addEventListener('input', e => {
        canvasHexSpan.textContent = e.target.value.toUpperCase();
    });

    // File input multi-selection listener
    const fileInput = card.querySelector('.variant-file-input');
    fileInput.addEventListener('change', e => {
        if (e.target.files && e.target.files.length > 0) {
            for (let i = 0; i < e.target.files.length; i++) {
                const file = e.target.files[i];
                card._variantImages.push({
                    type: 'file',
                    file: file,
                    previewUrl: URL.createObjectURL(file)
                });
            }
            renderVariantGallery(card);
            e.target.value = ''; // Reset so user can select more files if needed
        }
    });

    // Add URL button listener
    const addUrlInput = card.querySelector('.variant-add-url-input');
    const addUrlBtn = card.querySelector('.variant-add-url-btn');
    const addUrlAction = () => {
        const url = addUrlInput.value.trim();
        if (url) {
            card._variantImages.push({
                type: 'existing',
                url: url
            });
            addUrlInput.value = '';
            renderVariantGallery(card);
        }
    };
    addUrlBtn.addEventListener('click', addUrlAction);
    addUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addUrlAction();
        }
    });

    // Remove variant button
    card.querySelector('.btn-remove-variant').addEventListener('click', () => {
        if (el.variantsContainer.querySelectorAll('.variant-card').length <= 1) {
            showToast("Each product requires at least 1 color variant", "error");
            return;
        }
        card.remove();
    });

    el.variantsContainer.appendChild(card);
}

el.addVariantBtn.addEventListener('click', () => {
    createVariantCard({
        id: `var-${Date.now().toString().slice(-4)}`,
        colorName: 'Midnight Emerald',
        swatchHex: '#0D3822',
        canvasHex: '#082114',
        inStock: true
    });
});

function initNewProductForm() {
    state.editingProductId = null;
    el.productEditForm.reset();
    document.getElementById('prodId').disabled = false;
    document.getElementById('prodId').dataset.autoSlugified = 'false';
    const newArrivalsCheck = document.getElementById('prodInNewArrivals');
    if (newArrivalsCheck) newArrivalsCheck.checked = false;
    const isCuratedCheck = document.getElementById('prodIsCurated');
    if (isCuratedCheck) isCuratedCheck.checked = false;
    const isTrendingCheck = document.getElementById('prodIsTrending');
    if (isTrendingCheck) isTrendingCheck.checked = false;
    const genderSelect = document.getElementById('prodGender');
    if (genderSelect) genderSelect.value = 'WOMEN';
    const occasionTagsInput = document.getElementById('prodOccasionTags');
    if (occasionTagsInput) occasionTagsInput.value = '';

    el.variantsContainer.innerHTML = '';
    // Default first variant
    createVariantCard({
        id: 'var-1',
        colorName: 'Royal Burgundy',
        swatchHex: '#800020',
        canvasHex: '#4A0E17',
        inStock: true
    });
}

function editProduct(productId) {
    const prod = state.products.find(p => p.id === productId);
    if (!prod) return;

    state.editingProductId = productId;
    openProductForm(true);

    const idInput = document.getElementById('prodId');
    idInput.value = prod.id;
    idInput.disabled = true;

    document.getElementById('prodEditorialTitle').value = prod.editorialTitle || '';
    document.getElementById('prodFullName').value = prod.fullName || '';
    document.getElementById('prodCategory').value = prod.category || 'SAREES';
    const genderSelect = document.getElementById('prodGender');
    if (genderSelect) genderSelect.value = prod.gender || 'WOMEN';

    const newArrivalsCheck = document.getElementById('prodInNewArrivals');
    if (newArrivalsCheck) {
        newArrivalsCheck.checked = !!(prod.inNewArrivals || prod.isNewArrival);
    }
    const isCuratedCheck = document.getElementById('prodIsCurated');
    if (isCuratedCheck) {
        isCuratedCheck.checked = !!prod.isCurated;
    }
    const isTrendingCheck = document.getElementById('prodIsTrending');
    if (isTrendingCheck) {
        isTrendingCheck.checked = !!prod.isTrending;
    }
    const occasionTagsInput = document.getElementById('prodOccasionTags');
    if (occasionTagsInput) {
        occasionTagsInput.value = Array.isArray(prod.occasionTags) ? prod.occasionTags.join(', ') : (prod.occasionTags || '');
    }

    document.getElementById('prodPriceInr').value = prod.priceInr || '';
    document.getElementById('prodAvailableOptions').value = Array.isArray(prod.availableOptions) ? prod.availableOptions.join(', ') : (prod.availableOptions || '');
    document.getElementById('prodTopLeftSpec').value = prod.topLeftSpec || '';
    document.getElementById('prodTopRightSpec').value = prod.topRightSpec || '';
    document.getElementById('prodTrustBadge').value = prod.trustBadgeText || '';
    document.getElementById('prodDescription').value = prod.description || '';
    document.getElementById('prodDetails').value = prod.details || '';
    document.getElementById('prodCareInstructions').value = prod.careInstructions || '';

    el.variantsContainer.innerHTML = '';
    const variants = (prod.variants && prod.variants.length > 0) ? prod.variants : [{
        id: 'var-1',
        colorName: 'Standard',
        swatchHex: '#800020',
        canvasHex: '#4A0E17',
        imageUrl: prod.imageUrl || '',
        inStock: true
    }];

    variants.forEach(v => createVariantCard(v));
}

// Delete Product Confirmation
function confirmDeleteProduct(productId) {
    const prod = state.products.find(p => p.id === productId);
    const title = prod ? prod.fullName : productId;
    showConfirmModal(
        "Delete Heirloom Product",
        `Are you sure you want to permanently delete "${title}" (${productId}) from the Artpoure catalog? This action cannot be reversed.`,
        async () => {
            try {
                await deleteDoc(doc(db, "products", productId));
                showToast(`Deleted ${productId} successfully`, "success");
                await fetchProducts();
            } catch (err) {
                console.error("Error deleting product:", err);
                showToast(`Failed to delete product: ${err.message}`, "error");
            }
        }
    );
}

/**
 * Client-Side Image Compression using HTML Canvas before Firebase Storage upload.
 * Resizes proportionally if max(width, height) > maxDimension (default 1200px)
 * and exports as image/webp blob (quality 0.82) with fallback to original file.
 */
async function compressImageToWebP(file, maxDimension = 1200, quality = 0.82) {
    if (!file || !file.type.startsWith('image/')) return file;
    if (file.type.includes('svg')) return file;

    return new Promise((resolve) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            let { width, height } = img;
            if (width > maxDimension || height > maxDimension) {
                if (width > height) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                } else {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob((blob) => {
                if (blob && blob.size > 0 && blob.size < file.size) {
                    const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                    const webpFile = new File([blob], `${baseName}.webp`, { type: 'image/webp' });
                    resolve(webpFile);
                } else {
                    // Fall back to original file if compression failed or didn't reduce size
                    resolve(file);
                }
            }, 'image/webp', quality);
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(file);
        };
        img.src = objectUrl;
    });
}

// Form Submission: Uploads to Firebase Storage + Writes to Firestore
el.productEditForm.addEventListener('submit', async e => {
    e.preventDefault();

    const prodId = document.getElementById('prodId').value.trim();
    const editorialTitle = document.getElementById('prodEditorialTitle').value.trim();
    const fullName = document.getElementById('prodFullName').value.trim();
    const category = document.getElementById('prodCategory').value.trim();
    const gender = document.getElementById('prodGender')?.value?.trim() || 'WOMEN';
    const priceInr = Number(document.getElementById('prodPriceInr').value);
    const availableOptionsRaw = document.getElementById('prodAvailableOptions').value.trim();
    const topLeftSpec = document.getElementById('prodTopLeftSpec').value.trim();
    const topRightSpec = document.getElementById('prodTopRightSpec').value.trim();
    const trustBadgeText = document.getElementById('prodTrustBadge').value.trim();
    const description = document.getElementById('prodDescription').value.trim();
    const details = document.getElementById('prodDetails').value.trim();
    const careInstructions = document.getElementById('prodCareInstructions').value.trim();

    if (!prodId || !fullName || !priceInr || priceInr <= 0) {
        showToast("Please fill in valid Product ID, Title, and Price.", "error");
        return;
    }

    const variantCards = Array.from(el.variantsContainer.querySelectorAll('.variant-card'));
    if (variantCards.length === 0) {
        showToast("Please add at least 1 color variant.", "error");
        return;
    }

    // Lock Form
    el.saveProductBtn.disabled = true;
    el.formProgressFeedback.style.display = 'flex';
    el.formProgressMessage.textContent = "Processing product & photos...";

    try {
        const variantsData = [];

        for (let i = 0; i < variantCards.length; i++) {
            const card = variantCards[i];
            const vId = card.dataset.variantId || `var-${i + 1}`;
            const colorName = card.querySelector('.variant-color-name').value.trim();
            const swatchHex = card.querySelector('.variant-swatch-input').value;
            const canvasHex = card.querySelector('.variant-canvas-input').value;
            const inStock = card.querySelector('.variant-instock-check').checked;

            const imageItems = card._variantImages || [];
            if (imageItems.length === 0) {
                throw new Error(`Variant "${colorName}" requires at least 1 photo.`);
            }

            const resolvedUrls = [];
            for (let j = 0; j < imageItems.length; j++) {
                const item = imageItems[j];
                if (item.type === 'existing' && item.url) {
                    resolvedUrls.push(item.url);
                } else if (item.type === 'file' && item.file) {
                    el.formProgressMessage.textContent = `Compressing & uploading photo ${j + 1}/${imageItems.length} for variant "${colorName}"...`;
                    const fileToUpload = await compressImageToWebP(item.file, 1200, 0.82);
                    const fileExt = fileToUpload.type === 'image/webp' ? 'webp' : (fileToUpload.name.split('.').pop() || 'jpg');
                    const storagePath = `products/${prodId}/${vId}_${Date.now()}_${j}.${fileExt}`;
                    const storageRef = ref(storage, storagePath);
                    const snapshot = await uploadBytes(storageRef, fileToUpload);
                    const downloadUrl = await getDownloadURL(snapshot.ref);
                    resolvedUrls.push(downloadUrl);
                }
            }

            if (resolvedUrls.length === 0) {
                throw new Error(`Variant "${colorName}" requires at least 1 valid photo.`);
            }

            variantsData.push({
                id: vId,
                colorName: colorName || `Color ${i + 1}`,
                swatchHex: swatchHex,
                canvasHex: canvasHex,
                imageUrl: resolvedUrls[0],
                images: resolvedUrls,
                inStock: inStock
            });
        }

        el.formProgressMessage.textContent = "Saving product document in Firestore...";

        const availableOptions = availableOptionsRaw
            ? availableOptionsRaw.split(',').map(s => s.trim()).filter(Boolean)
            : ['Free Size'];

        const inNewArrivals = !!(document.getElementById('prodInNewArrivals')?.checked);
        const isCurated = !!(document.getElementById('prodIsCurated')?.checked);
        const isTrending = !!(document.getElementById('prodIsTrending')?.checked);
        const occasionTagsRaw = document.getElementById('prodOccasionTags')?.value?.trim() || '';
        const occasionTags = occasionTagsRaw
            ? occasionTagsRaw.split(',').map(s => s.trim()).filter(Boolean)
            : [];

        const productDoc = {
            id: prodId,
            editorialTitle: editorialTitle.toUpperCase(),
            fullName: fullName,
            category: category,
            gender: gender,
            isCurated: isCurated,
            isTrending: isTrending,
            occasionTags: occasionTags,
            inNewArrivals: inNewArrivals,
            isNewArrival: inNewArrivals,
            priceInr: priceInr,
            availableOptions: availableOptions,
            topLeftSpec: topLeftSpec,
            topRightSpec: topRightSpec,
            trustBadgeText: trustBadgeText,
            description: description,
            details: details,
            careInstructions: careInstructions,
            imageUrl: variantsData[0].imageUrl,
            variants: variantsData,
            updatedAt: serverTimestamp()
        };

        // Write to Firestore products collection
        await setDoc(doc(db, "products", prodId), productDoc, { merge: true });

        showToast(`Heirloom "${fullName}" saved successfully!`, "success");
        closeProductForm();
        await fetchProducts();

    } catch (err) {
        console.error("Save Product Error:", err);
        showToast(`Error saving product: ${err.message}`, "error");
    } finally {
        el.saveProductBtn.disabled = false;
        el.formProgressFeedback.style.display = 'none';
    }
});

// =============================================================================
// TAB 2: ORDERS (Fulfillment & Tracking)
// =============================================================================

async function fetchOrders() {
    el.ordersLoadingSpinner.style.display = 'flex';
    el.ordersEmptyState.style.display = 'none';
    el.ordersList.innerHTML = '';

    try {
        let querySnapshot;
        try {
            querySnapshot = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc")));
        } catch (idxErr) {
            console.warn("Index warning, falling back to unordered fetch:", idxErr);
            querySnapshot = await getDocs(collection(db, "orders"));
        }

        const items = [];
        querySnapshot.forEach(docSnap => {
            items.push({ id: docSnap.id, ...docSnap.data() });
        });

        // Fallback in-memory sort by date descending
        items.sort((a, b) => {
            const timeA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
            const timeB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
            return timeB - timeA;
        });

        state.orders = items;
        el.ordersCountBadge.textContent = items.length;
        renderOrdersList();
    } catch (err) {
        console.error("Error fetching orders:", err);
        showToast(`Could not load orders: ${err.message}`, "error");
    } finally {
        el.ordersLoadingSpinner.style.display = 'none';
    }
}

function renderOrdersList() {
    const queryStr = state.orderSearchQuery.toLowerCase().trim();
    const filterStatus = state.orderFilterStatus;

    const filtered = state.orders.filter(ord => {
        const status = (ord.status || 'CONFIRMED').toUpperCase();
        const payMethod = (ord.paymentMethod || 'RAZORPAY').toUpperCase();
        const rawPayStatus = (ord.paymentStatus || '').toUpperCase();
        const payStatus = rawPayStatus || (payMethod === 'COD' ? 'PENDING_COD' : 'PENDING');

        let matchesFilter = false;
        if (filterStatus === 'ALL') matchesFilter = true;
        else if (filterStatus === 'PAID') matchesFilter = payStatus === 'PAID' || payStatus === 'COLLECTED';
        else if (filterStatus === 'PENDING') matchesFilter = payStatus === 'PENDING' || payStatus === 'PENDING_COD' || status === 'PENDING';
        else if (filterStatus === 'COD') matchesFilter = payMethod === 'COD';
        else if (filterStatus === 'SHIPPED') matchesFilter = status === 'SHIPPED';
        else if (filterStatus === 'DELIVERED') matchesFilter = status === 'DELIVERED';

        const matchesSearch = !queryStr ||
            (ord.id && ord.id.toLowerCase().includes(queryStr)) ||
            (ord.shippingAddress?.receiverName && ord.shippingAddress.receiverName.toLowerCase().includes(queryStr)) ||
            (ord.shippingAddress?.receiverPhone && ord.shippingAddress.receiverPhone.includes(queryStr));

        return matchesFilter && matchesSearch;
    });

    if (filtered.length === 0) {
        el.ordersEmptyState.style.display = 'block';
        el.ordersList.innerHTML = '';
        return;
    }

    el.ordersEmptyState.style.display = 'none';
    el.ordersList.innerHTML = filtered.map(ord => {
        const orderId = ord.orderId || ord.id;
        const dateStr = ord.createdAt?.seconds
            ? new Date(ord.createdAt.seconds * 1000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
            : (ord.createdAt ? new Date(ord.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Recent');

        const addr = ord.shippingAddress || {};
        const fullAddr = [addr.houseFlat, addr.floor, addr.street, addr.area, addr.city, addr.pinCode].filter(Boolean).join(', ');

        const pricing = ord.pricing || {};
        const grandTotal = pricing.grandTotalInr || ord.grandTotalInr || 0;
        const formattedTotal = Number(grandTotal).toLocaleString('en-IN');

        const payMethod = ord.paymentMethod || 'RAZORPAY';
        const rawPayStatus = (ord.paymentStatus || '').toUpperCase();
        const payStatus = rawPayStatus || (payMethod === 'COD' ? 'PENDING_COD' : 'PENDING');
        const fulfillmentStatus = (ord.status || 'CONFIRMED').toUpperCase();
        const trackingNum = ord.trackingNumber || '';
        const courier = ord.courierName || '';

        const itemsList = ord.items || [];
        const itemsRows = itemsList.map(item => {
            const title = item.fullName || item.title || item.productId || 'Heirloom';
            const color = item.colorName || item.variantId || 'Standard';
            const qty = item.quantity || 1;
            const price = Number(item.unitPriceInr || item.priceInr || 0).toLocaleString('en-IN');
            return `
                <tr>
                    <td><strong>${title}</strong><br><small style="color: var(--gold);">${color}</small></td>
                    <td>${qty}</td>
                    <td>₹${price}</td>
                </tr>
            `;
        }).join('');

        const payStatusClass = (payStatus === 'PAID' || payStatus === 'COLLECTED') ? 'paid' : (payMethod === 'COD' ? 'cod' : 'pending');
        const fulfillStatusClass = fulfillmentStatus.toLowerCase();
        const payBadgeText = payMethod === 'COD'
            ? (payStatus === 'COLLECTED' ? 'COD: COLLECTED' : 'COD: PENDING_COD')
            : (payStatus === 'PAID' ? 'PREPAID: PAID' : 'PREPAID: PENDING');

        return `
            <div class="order-card" data-order-id="${ord.id}">
                <div class="order-card-header">
                    <div class="order-id-wrap">
                        <span class="order-id-badge">${orderId}</span>
                        <span class="order-date-text">• ${dateStr}</span>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <span class="status-badge ${payStatusClass}">${payBadgeText}</span>
                        <span class="status-badge ${fulfillStatusClass}">${fulfillmentStatus}</span>
                    </div>
                </div>

                ${(ord.stockConflict || fulfillmentStatus === 'CONFLICT_REFUND_REQUIRED') ? `
                    <div style="background: rgba(229, 57, 53, 0.15); border: 1px solid #E53935; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; color: #FFCDD2; font-size: 13px; font-weight: 600;">
                        ⚠️ <strong>STOCK CONFLICT DETECTED:</strong> ${ord.conflictReason || '1-of-1 piece was claimed in another checkout. Please issue an immediate refund in Razorpay Dashboard.'}
                    </div>
                ` : ''}

                <div class="order-card-grid">
                    <div class="order-info-column">
                        <span class="order-info-label">Customer</span>
                        <span class="order-info-value"><strong>${addr.receiverName || 'Guest Client'}</strong></span>
                        <span class="order-info-value"><a href="tel:${addr.receiverPhone || ''}">📞 ${addr.receiverPhone || 'No Phone'}</a></span>
                    </div>

                    <div class="order-info-column">
                        <span class="order-info-label">Shipping Destination</span>
                        <span class="order-info-value">${fullAddr || 'No address details'}</span>
                    </div>

                    <div class="order-info-column">
                        <span class="order-info-label">Payment & Grand Total</span>
                        <span class="order-info-value" style="font-size: 16px; font-weight: 700; color: var(--gold);">₹${formattedTotal}</span>
                        <span class="order-info-value" style="font-size: 11px; color: var(--text-muted);">${ord.razorpayPaymentId ? `Razorpay ID: ${ord.razorpayPaymentId}` : (payMethod === 'COD' ? `Insured COD (${payStatus})` : payMethod)}</span>
                    </div>
                </div>

                <!-- Itemized Products Table -->
                <table class="order-items-table">
                    <thead>
                        <tr>
                            <th>Item & Variant</th>
                            <th>Qty</th>
                            <th>Price</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsRows}
                    </tbody>
                </table>

                <!-- Inline Fulfillment & Payment Status Manager -->
                <div class="order-fulfillment-box" style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <label style="font-size: 11px; font-weight: 600; color: var(--gold);">FULFILLMENT:</label>
                        <select class="fulfillment-select order-status-select" data-id="${ord.id}">
                            <option value="CONFIRMED" ${fulfillmentStatus === 'CONFIRMED' ? 'selected' : ''}>CONFIRMED</option>
                            <option value="PACKED" ${fulfillmentStatus === 'PACKED' ? 'selected' : ''}>PACKED</option>
                            <option value="SHIPPED" ${fulfillmentStatus === 'SHIPPED' ? 'selected' : ''}>SHIPPED</option>
                            <option value="DELIVERED" ${fulfillmentStatus === 'DELIVERED' ? 'selected' : ''}>DELIVERED</option>
                            <option value="CANCELLED" ${fulfillmentStatus === 'CANCELLED' ? 'selected' : ''}>CANCELLED</option>
                            <option value="CONFLICT_REFUND_REQUIRED" ${fulfillmentStatus === 'CONFLICT_REFUND_REQUIRED' ? 'selected' : ''}>CONFLICT: REFUND REQUIRED</option>
                        </select>
                    </div>

                    <div style="display: flex; align-items: center; gap: 6px;">
                        <label style="font-size: 11px; font-weight: 600; color: var(--gold);">PAYMENT:</label>
                        <select class="fulfillment-select order-payment-status-select" data-id="${ord.id}">
                            ${payMethod === 'COD' ? `
                                <option value="PENDING_COD" ${payStatus === 'PENDING_COD' ? 'selected' : ''}>COD: PENDING_COD</option>
                                <option value="COLLECTED" ${payStatus === 'COLLECTED' ? 'selected' : ''}>COD: COLLECTED</option>
                                <option value="CANCELLED" ${payStatus === 'CANCELLED' ? 'selected' : ''}>CANCELLED</option>
                            ` : `
                                <option value="PAID" ${payStatus === 'PAID' ? 'selected' : ''}>PREPAID: PAID</option>
                                <option value="PENDING" ${payStatus === 'PENDING' ? 'selected' : ''}>PREPAID: PENDING</option>
                                <option value="REFUNDED" ${payStatus === 'REFUNDED' ? 'selected' : ''}>REFUNDED</option>
                                <option value="FAILED" ${payStatus === 'FAILED' ? 'selected' : ''}>FAILED</option>
                            `}
                        </select>
                    </div>

                    <input type="text" class="fulfillment-input order-courier-input" placeholder="Courier (e.g. BlueDart)" value="${courier}" data-id="${ord.id}" style="max-width: 140px;">
                    <input type="text" class="fulfillment-input order-tracking-input" placeholder="AWB / Tracking #" value="${trackingNum}" data-id="${ord.id}" style="max-width: 140px;">

                    <button class="btn-primary-action btn-sm save-fulfillment-btn" data-id="${ord.id}">
                        <span>Save Update</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Attach fulfillment save listeners
    el.ordersList.querySelectorAll('.save-fulfillment-btn').forEach(btn => {
        btn.addEventListener('click', () => saveOrderFulfillment(btn.dataset.id));
    });
}

// Order fulfillment updates
async function saveOrderFulfillment(docId) {
    const card = el.ordersList.querySelector(`.order-card[data-order-id="${docId}"]`);
    if (!card) return;

    const statusSelect = card.querySelector('.order-status-select');
    const paymentStatusSelect = card.querySelector('.order-payment-status-select');
    const courierInput = card.querySelector('.order-courier-input');
    const trackingInput = card.querySelector('.order-tracking-input');
    const saveBtn = card.querySelector('.save-fulfillment-btn');

    const newStatus = statusSelect.value;
    const newPaymentStatus = paymentStatusSelect ? paymentStatusSelect.value : null;
    const courierVal = courierInput.value.trim();
    const trackingVal = trackingInput.value.trim();

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const updatePayload = {
            status: newStatus,
            courierName: courierVal,
            trackingNumber: trackingVal,
            updatedAt: serverTimestamp()
        };
        if (newPaymentStatus) {
            updatePayload.paymentStatus = newPaymentStatus;
            if (newPaymentStatus === 'COLLECTED' || newPaymentStatus === 'PAID') {
                updatePayload.paidAt = serverTimestamp();
            }
        }

        await updateDoc(doc(db, "orders", docId), updatePayload);

        showToast(`Order ${docId} updated: ${newStatus} (${newPaymentStatus || ''})`, "success");
        await fetchOrders();
    } catch (err) {
        console.error("Order fulfillment update error:", err);
        showToast(`Failed to update order: ${err.message}`, "error");
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Update';
    }
}

el.refreshOrdersBtn.addEventListener('click', fetchOrders);

el.orderSearchInput.addEventListener('input', e => {
    state.orderSearchQuery = e.target.value;
    renderOrdersList();
});

el.orderStatusFilters.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        el.orderStatusFilters.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.orderFilterStatus = pill.dataset.status;
        renderOrdersList();
    });
});

// =============================================================================
// TAB 3: CONSULTATIONS (Atelier Appointments)
// =============================================================================

async function fetchConsultations() {
    el.consultationsLoadingSpinner.style.display = 'flex';
    el.consultationsEmptyState.style.display = 'none';
    el.consultationsList.innerHTML = '';

    try {
        let querySnapshot;
        try {
            querySnapshot = await getDocs(query(collection(db, "appointments"), orderBy("bookedAt", "desc")));
        } catch (idxErr) {
            console.warn("Index warning, falling back to unordered fetch:", idxErr);
            querySnapshot = await getDocs(collection(db, "appointments"));
        }

        const items = [];
        querySnapshot.forEach(docSnap => {
            items.push({ id: docSnap.id, ...docSnap.data() });
        });

        items.sort((a, b) => {
            const timeA = a.bookedAt ? new Date(a.bookedAt).getTime() : 0;
            const timeB = b.bookedAt ? new Date(b.bookedAt).getTime() : 0;
            return timeB - timeA;
        });

        state.appointments = items;
        el.consultationsCountBadge.textContent = items.length;
        renderConsultationsList();
    } catch (err) {
        console.error("Error fetching consultations:", err);
        showToast(`Could not load consultations: ${err.message}`, "error");
    } finally {
        el.consultationsLoadingSpinner.style.display = 'none';
    }
}

function renderConsultationsList() {
    const queryStr = state.consultationSearchQuery.toLowerCase().trim();
    const filterStatus = state.consultationFilterStatus;

    const filtered = state.appointments.filter(apt => {
        const status = (apt.status || 'CONFIRMED').toUpperCase();
        const matchesFilter = (filterStatus === 'ALL') || (status === filterStatus);
        const matchesSearch = !queryStr ||
            (apt.clientName && apt.clientName.toLowerCase().includes(queryStr)) ||
            (apt.clientPhone && apt.clientPhone.includes(queryStr)) ||
            (apt.preferredWeave && apt.preferredWeave.toLowerCase().includes(queryStr));
        return matchesFilter && matchesSearch;
    });

    if (filtered.length === 0) {
        el.consultationsEmptyState.style.display = 'block';
        el.consultationsList.innerHTML = '';
        return;
    }

    el.consultationsEmptyState.style.display = 'none';
    el.consultationsList.innerHTML = filtered.map(apt => {
        const aptId = apt.id;
        const status = apt.status || 'CONFIRMED';
        const dateStr = apt.bookedAt ? new Date(apt.bookedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : 'Recent';
        const statusClass = status.toLowerCase();

        return `
            <div class="consultation-card" data-apt-id="${aptId}">
                <div class="consultation-card-header">
                    <h4 class="client-name">${apt.clientName || 'Bespoke Client'}</h4>
                    <span class="status-badge ${statusClass}">${status}</span>
                </div>

                <div class="consultation-detail-row">
                    <span class="consultation-detail-label">Client Phone</span>
                    <span class="consultation-detail-value"><a href="tel:${apt.clientPhone || ''}">📞 ${apt.clientPhone || 'No Phone'}</a></span>
                </div>

                <div class="consultation-detail-row">
                    <span class="consultation-detail-label">Preferred Appointment Date</span>
                    <span class="consultation-detail-value" style="color: var(--gold); font-weight: 600;">📅 ${apt.preferredDate || 'Not specified'}</span>
                </div>

                <div class="consultation-detail-row">
                    <span class="consultation-detail-label">Preferred Weave / Silhouette</span>
                    <span class="consultation-detail-value">${apt.preferredWeave || 'General Haute Couture Consultation'}</span>
                </div>

                <div class="consultation-detail-row">
                    <span class="consultation-detail-label">Booked On</span>
                    <span class="consultation-detail-value" style="font-size: 11px; color: var(--text-muted);">${dateStr}</span>
                </div>

                <div class="consultation-actions">
                    ${status !== 'COMPLETED' ? `<button class="btn-card-action complete-apt-btn" data-id="${aptId}">✓ Complete</button>` : ''}
                    ${status !== 'CANCELLED' ? `<button class="btn-card-action danger cancel-apt-btn" data-id="${aptId}">✕ Cancel</button>` : ''}
                    <button class="btn-card-action danger delete-apt-btn" data-id="${aptId}">🗑 Delete</button>
                </div>
            </div>
        `;
    }).join('');

    // Attach consultation action listeners
    el.consultationsList.querySelectorAll('.complete-apt-btn').forEach(btn => {
        btn.addEventListener('click', () => updateAppointmentStatus(btn.dataset.id, 'COMPLETED'));
    });
    el.consultationsList.querySelectorAll('.cancel-apt-btn').forEach(btn => {
        btn.addEventListener('click', () => updateAppointmentStatus(btn.dataset.id, 'CANCELLED'));
    });
    el.consultationsList.querySelectorAll('.delete-apt-btn').forEach(btn => {
        btn.addEventListener('click', () => confirmDeleteAppointment(btn.dataset.id));
    });
}

async function updateAppointmentStatus(aptId, newStatus) {
    try {
        await updateDoc(doc(db, "appointments", aptId), {
            status: newStatus,
            updatedAt: serverTimestamp()
        });
        showToast(`Consultation marked as ${newStatus}`, "success");
        await fetchConsultations();
    } catch (err) {
        console.error("Consultation update error:", err);
        showToast(`Failed to update consultation: ${err.message}`, "error");
    }
}

function confirmDeleteAppointment(aptId) {
    showConfirmModal(
        "Delete Consultation",
        `Are you sure you want to permanently delete appointment ${aptId}?`,
        async () => {
            try {
                await deleteDoc(doc(db, "appointments", aptId));
                showToast(`Consultation ${aptId} deleted`, "success");
                await fetchConsultations();
            } catch (err) {
                console.error("Error deleting consultation:", err);
                showToast(`Failed to delete consultation: ${err.message}`, "error");
            }
        }
    );
}

el.refreshConsultationsBtn.addEventListener('click', fetchConsultations);

el.consultationSearchInput.addEventListener('input', e => {
    state.consultationSearchQuery = e.target.value;
    renderConsultationsList();
});

el.consultationStatusFilters.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        el.consultationStatusFilters.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.consultationFilterStatus = pill.dataset.status;
        renderConsultationsList();
    });
});
