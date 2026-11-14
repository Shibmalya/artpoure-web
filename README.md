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
├── public/
│   ├── index.html          # Semantic HTML5 layout (Ambient video, Cascading Header, Showcase, Catalog)
│   ├── style.css           # Pure CSS custom properties, light/dark themes, glassmorphism, responsive grid
│   ├── app.js              # Vanilla ES6 application logic (State, catalog rendering, cart/wishlist, scroll physics)
│   ├── firebase-config.js  # Firebase v10 Modular Web SDK configuration (Auth & Firestore)
│   └── 404.html            # Custom luxury 404 page
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
```

### Shared Firestore Collections
- **`products`**: Shared product catalog with nested `variants` matching `MockCatalogRepository.kt`.
- **`users/{userId}/cart`**: User cart synchronizable with mobile session.
- **`users/{userId}/wishlist`**: Saved items.

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
