# Artpoure • Haute Ethnic Editorial Web Frontend

> **Bespoke Luxury Ethnic Wear E-Commerce Platform**  
> Direct 1:1 responsive Web counterpart to the **Artpoure Android application** (Jetpack Compose), sharing the same visual identity, typography, design tokens, color palette, and Firebase v10 backend.

---

## 👑 Brand Philosophy & Aesthetic

**Artpoure** curates heirloom handwoven Banarasi sarees, pure Kanjeevaram silks, couture floor-length Anarkalis, and temple heritage polki jewelry.

The frontend is built with an **editorial luxury catalog layout**, mimicking high-fashion print magazines while providing fluid interaction physics.

---

## 🎨 Design System & Parity with Android Jetpack Compose

| Component | Android Jetpack Compose | Web Frontend (`public/`) |
| :--- | :--- | :--- |
| **Typography** | `FontFamily.Serif` Black (Cinzel/Playfair) & `FontFamily.SansSerif` (Inter/Montserrat) | Cinzel (Serif 900) & Montserrat (Sans-Serif 400–700) |
| **Color Tokens** | `accentGold` (`#D4AF37`), `canvasBackground` (`#0E0D0C` / `#FAF9F5`), `editorialCrimson` (`#6B1D26`) | CSS Variables: `--accent-gold`, `--canvas-bg`, `--surface`, `--text-primary` |
| **Dynamic Background** | `LoopingVideoBackground.kt` (Curtain of golden silk with subtle scrim) | `<video class="ambient-video" autoplay loop muted playsinline>` + translucent scrim |
| **Header Physics** | Multi-layer cascading scroll: brand title morphs into floating centered pill | `.header-wrapper.scrolled`: Brand layer centers and compresses into a glassmorphism pill (`backdrop-filter: blur(16px)`) |
| **Product Cards** | `EditorialProductCard.kt` with live color swatch selector and canvas color tinting | `.editorial-card` with interactive `.swatch` pills dynamically changing variant images and card background tint |
| **Navigation** | Floating pill navigation bar at bottom center | Floating bottom dock pill with bag count badge and quick category jump |

---

## 📁 Repository Structure

```text
ArtpoureWeb/
├── .github/
│   └── workflows/
│       ├── firebase-hosting-merge.yml         # CI/CD auto-deploy on push to main
│       └── firebase-hosting-pull-request.yml  # Preview deployments on PRs
├── docs/
│   └── Artpoure_Unified_Architecture_Report.md # Full unified architecture documentation
├── public/
│   ├── index.html          # Semantic HTML5 layout (Ambient video, Cascading Header, Showcase, Curated Rail, Catalog)
│   ├── style.css           # Pure CSS custom properties, light/dark themes, glassmorphism, responsive grid
│   ├── app.js              # Vanilla ES6 application logic (State, catalog rendering, Curated Picks, Waitlist, checkout)
│   ├── admin.html          # Private Mobile-Friendly Admin Portal (Catalog, WebP upload, Orders & Fulfillment)
│   ├── admin.js            # Admin portal reactive logic & Firebase Storage WebP upload
│   ├── admin.css           # Admin styling & mobile-responsive tables
│   ├── firebase-config.js  # Firebase v10 Modular Web SDK configuration (Auth, Firestore, Storage, Functions)
│   └── 404.html            # Custom luxury 404 page
├── functions/              # Cloud Functions v2 (Razorpay payments & serverless COD engine)
├── storage.rules           # Production Firebase Storage security rules
├── firestore.rules         # Production Cloud Firestore security rules
├── firebase.json           # Firebase Hosting configuration (Rewrites, cache headers)
├── .firebaserc             # Firebase project targeting (`shibanya-1625`)
└── README.md
```

---

## ⚡ Firebase v10 Integration

The web frontend communicates directly with the shared Firebase project using the modular Firebase Web SDK:

```javascript
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-storage.js";
```

### Shared Firestore Collections & Storage
- **`products`**: Real-time synced product catalog with merchandising flags (`isCurated`, `isTrending`, `inNewArrivals`, `gender`, `occasionTags`) and multi-color variant galleries.
- **`orders`**: Authoritative order documents created strictly by Cloud Functions Admin SDK, with distinct fulfillment and payment statuses.
- **`appointments`**: 1-on-1 virtual atelier consultations with date picker and weave requests.
- **`waitlist`**: Client notification requests for upcoming collections with WhatsApp/Email contact.
- **Firebase Storage (`products/`)**: Multi-angle WebP variant photos compressed on client canvas prior to upload.

---

## 📖 Comprehensive Documentation

For complete architectural details, scoring formulas, pricing policies, and parity specifications, inspect:
- [Artpoure Unified Architecture & Implementation Report](docs/Artpoure_Unified_Architecture_Report.md)

---

## 🚀 Local Development

No Node.js build step is required for basic local preview:

1. **Serve locally**:
   ```bash
   npx serve public
   # or
   python -m http.server 8000 -d public
   ```
2. Open `http://localhost:8000` in any browser.

---

## 🌐 Deployment to Firebase Hosting

Automated deployments are configured via GitHub Actions when pushing to `main`. To manually deploy via CLI:

```bash
firebase deploy --only hosting
```
