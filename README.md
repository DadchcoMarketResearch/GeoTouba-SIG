# GeoTouba — Portail SIG Déchets Organiques
**Plateforme complète de cartographie interactive, application mobile terrain, alertes temps réel et exports QGIS pour la gestion des déchets organiques à Touba, Sénégal**

---

## 🌍 Vue d'ensemble du projet

**GeoTouba** est une suite d'outils SIG comprenant :
1. 🗺️ **Portail cartographique** — carte Leaflet interactive multi-couches
2. 📱 **App mobile PWA** — interface terrain pour les agents de collecte
3. 🔔 **Centre d'alertes** — notifications SMS/email/push temps réel
4. 📥 **Export QGIS** — génération de fichiers GeoJSON/CSV compatibles QGIS

---

## 📱 Application mobile PWA Agent (`/agent`)

### Fonctionnalités
- **Installable sur l'écran d'accueil** (iOS + Android) via manifest.json
- **Mode hors-ligne** — Service Worker + cache stratégique
- **Bannière d'installation** automatique (beforeinstallprompt)
- **3 onglets** : Tableau de bord / Liste des points / Profil agent

### Actions terrain (bottom sheets)
| Action | Description |
|--------|-------------|
| ♻️ Mettre à jour | Slider taux de remplissage 0-100% avec couleur dynamique |
| ⚠️ Signaler | Problème terrain (débordement, dégradation, incendie…) |
| 🚛 Confirmer collecte | Volume, qualité, destination (compostage/biogaz/tri) |
| 📍 Ma position GPS | Coordonnées précises avec rayon de précision |

### Alertes push
- **Notification automatique** si taux ≥ 80% lors d'une mise à jour
- **Vibration** sur mobile (pattern [200,100,200])
- **Actions dans la notification** : Voir sur la carte / Fermer

---

## 🔔 Centre d'alertes (`/alertes`)

### KPIs en temps réel
- Bacs critiques (≥ 90%)
- Bacs en alerte (≥ 80%)
- Bacs normaux
- Total points actifs

### Canaux de notification configurables
| Canal | Fournisseur | Usage |
|-------|-------------|-------|
| 📱 SMS | Twilio / Orange Money API | Alerte immédiate agents terrain |
| 📧 Email | SMTP / Resend | Rapport coordinateurs |
| 🔔 Push | Web Notifications API | App agent PWA |

### Seuils configurables
- Avertissement : slider 50-95% (défaut 80%)
- Critique : slider 60-100% (défaut 90%)

### Destinataires pré-configurés
- Coordinateur SIG, Chef collecte, Comité Magal Environnement

---

## 📥 Export QGIS (`/export`)

### Formats disponibles
| Export | Format | Entités | Usage |
|--------|--------|---------|-------|
| Points de collecte | GeoJSON | 12 | Import QGIS direct |
| Sources déchets | GeoJSON | 6 | Restaurants/Dahiras |
| Projets valorisation | GeoJSON | 3 | WACA/ENDA/Magal |
| Toutes couches | GeoJSON | 21 | Carte complète |
| Points + attributs | CSV UTF-8 | 12 | Tableur + QGIS |
| Alertes actives | CSV | Variable | Intervention terrain |

### Système de coordonnées
- **Export** : WGS84 (EPSG:4326)
- **Reprojection recommandée** : UTM Zone 28N (EPSG:32628) pour analyses métriques

### Guide d'import QGIS inclus (6 étapes)
1. Télécharger GeoJSON → 2. Importer dans QGIS → 3. Reprojeter → 4. Symbologie gradée → 5. Fond OSM → 6. Export PDF

---

## 🔌 API REST complète

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/points-collecte` | GET | Liste avec filtres (type, statut, phase) |
| `/api/points-collecte/:id` | GET | Détail d'un point |
| `/api/restaurants` | GET | Sources de déchets |
| `/api/projets` | GET | Projets de valorisation |
| `/api/stats` | GET | Statistiques globales |
| `/api/alertes` | GET | Bacs en alerte (≥ 80%) |
| `/api/protocole-magal` | GET | Protocole 3 phases |
| `/api/terrain/update` | POST | Mise à jour terrain |
| `/api/terrain/signalement` | POST | Signalement problème |
| `/api/notifications/test` | POST | Test SMS/email |
| `/api/export/geojson` | GET | Export GeoJSON (?layer=) |
| `/api/export/csv` | GET | Export CSV UTF-8 |
| `/manifest.json` | GET | PWA manifest |
| `/sw.js` | GET | Service Worker |

---

## 🗺️ Carte interactive (`/`)

- 3 fonds : OSM / Satellite / Sombre
- 12 points géoréférencés (GPS réels Touba)
- 5 couches superposables
- Filtres : type / statut / phase Magal
- Fiche détaillée + export JSON par point
- Protocole Magal (3 phases)
- Tableau de bord statistiques
- Navigation vers Agent / Alertes / QGIS

---

## 🚀 Stack technique

| Composant | Technologie |
|-----------|-------------|
| Backend | Hono.js (TypeScript) |
| Déploiement | Cloudflare Pages/Workers |
| Cartographie | Leaflet.js 1.9.4 |
| PWA | Web App Manifest + Service Worker |
| Notifications | Web Notifications API + Push API |
| Export SIG | GeoJSON / CSV (WGS84 EPSG:4326) |
| Build | Vite 6 + @hono/vite-build |

---

## 🔧 Installation

```bash
git clone https://github.com/<votre-username>/geotouba.git
cd geotouba && npm install
npm run build
pm2 start ecosystem.config.cjs
open http://localhost:3000
```

---

## 📋 Statut déploiement

- **Plateforme** : Cloudflare Pages
- **Statut** : ✅ Opérationnel
- **Dernière mise à jour** : 2026-06-25
- **Commits** : 3 (Initial → SIG Carte → PWA+Alertes+Export)


---

## 🌍 Vue d'ensemble du projet

**GeoTouba** est un portail SIG (Système d'Information Géographique) web conçu pour :
- Visualiser en temps réel les **points de collecte de déchets organiques** de Touba
- Superposer plusieurs **couches d'information** (restaurants, projets de valorisation, densité)
- Gérer le **protocole de mise à jour** avant, pendant et après le Grand Magal
- Fournir un **tableau de bord opérationnel** aux gestionnaires de la ville

---

## 🗺️ Fonctionnalités principales

### Carte interactive (Leaflet.js)
- **3 fonds de carte** : Plan OSM, Vue Satellite (Esri), Mode Sombre (CartoDB)
- **Marqueurs dynamiques** avec indicateurs de remplissage (anneau SVG)
- **Popups enrichis** avec informations clés et accès à la fiche détaillée
- **Zoom et navigation** fluides centrés sur Touba

### Points de collecte (12 points géoréférencés)
| Type | Icône | Description |
|------|-------|-------------|
| Bac à ordures | 🗑️ | Bacs municipaux de collecte |
| Point apport volontaire | ♻️ | Dépôt par les citoyens |
| Plateforme compostage | 🌱 | Valorisation en compost |
| Centre de tri | 🔄 | Tri et orientation des flux |
| Unité biogaz | ⚡ | Production d'énergie renouvelable |

### Couches cartographiques superposées
1. **Points de collecte** (activée par défaut) — marqueurs avec taux de remplissage
2. **Sources de déchets** — 6 restaurants/daharas avec estimation de production
3. **Projets de valorisation** — 3 projets actifs (WACA, ENDA, Comité Magal)
4. **Zones de chaleur** — densité et criticité des points
5. **Réseau routier** — fond OSM intégré

### Filtres et navigation
- Filtre par **type de point** (5 catégories)
- Filtre par **statut** (actif / inactif)
- Filtre par **phase Magal** (normale / pré-Magal / Magal / post-Magal)
- **Barre de recherche** par nom, quartier, adresse
- **Liste des points** avec barre de remplissage visuelle

### Fiche détaillée par point
- KPIs : capacité, taux de remplissage
- Indicateur visuel de criticité (🟢 Normal / 🟡 Moyen / 🔴 Critique)
- Informations : responsable, fréquence, horaires de collecte
- Types de déchets organiques
- Phases d'activité (Magal)
- Notes opérationnelles
- Export JSON de la fiche

---

## 📅 Protocole de mise à jour — Grand Magal de Touba

La plateforme intègre un protocole structuré en 3 phases :

### Phase 1 : Pré-Magal (J-30 à J-1)
- Recensement et cartographie de tous les points
- Installation de 150 bacs supplémentaires
- Formation de 250 agents de collecte
- Mise à jour de la carte SIG avec nouveaux points

### Phase 2 : Pendant le Magal (J0 à J+3)
- Collecte 2-4x/jour dans les zones centrales
- Veille permanente H24 via tableau de bord SIG
- Mise à jour en temps réel du taux de remplissage
- 30 camions supplémentaires coordonnés via carte mobile

### Phase 3 : Post-Magal (J+4 à J+30)
- Nettoyage général + inventaire matériel
- Valorisation du surplus organique (compostage/biogaz)
- Bilan quantitatif et rapport d'évaluation
- Archivage des données cartographiques

---

## 🔌 API REST disponibles

| Endpoint | Description |
|----------|-------------|
| `GET /api/points-collecte` | Liste tous les points (filtres: `?type=`, `?statut=`, `?phase=`) |
| `GET /api/points-collecte/:id` | Détail d'un point par ID |
| `GET /api/restaurants` | Sources de déchets (restaurants/daharas) |
| `GET /api/projets` | Projets de valorisation existants |
| `GET /api/stats` | Statistiques globales + phase Magal courante |
| `GET /api/protocole-magal` | Protocole de mise à jour détaillé |

### Exemples d'appels API
```bash
# Tous les bacs actifs
curl /api/points-collecte?type=bac_ordures&statut=actif

# Points actifs pendant le Magal
curl /api/points-collecte?phase=magal

# Statistiques globales
curl /api/stats
```

---

## 🗄️ Architecture des données

### Modèle — Point de collecte
```json
{
  "id": 1,
  "nom": "Bac Central Marché Ocas",
  "type": "bac_ordures",
  "statut": "actif",
  "lat": 14.8658,
  "lng": -15.8780,
  "adresse": "Marché Ocas, Touba",
  "quartier": "Centre Touba",
  "capacite_m3": 8,
  "taux_remplissage": 72,
  "frequence_collecte": "Quotidienne",
  "responsable": "Mairie de Touba",
  "phase_active": ["normale", "pre-magal", "magal", "post-magal"],
  "types_dechets": ["Déchets alimentaires", "Résidus végétaux"],
  "coordonnees_gps": "14.8658°N, 15.8780°W"
}
```

### Stockage
- **Statique (prototype)** : Données embarquées dans l'API Hono
- **Production recommandée** : Cloudflare D1 (SQLite) + API QGIS Server pour données SIG avancées

---

## 🚀 Stack technique

| Composant | Technologie |
|-----------|-------------|
| Backend | Hono.js (TypeScript) |
| Déploiement | Cloudflare Pages / Workers |
| Cartographie | Leaflet.js 1.9.4 |
| Fonds de carte | OpenStreetMap, Esri Satellite, CartoDB |
| UI | CSS natif + FontAwesome + Inter font |
| Build | Vite 6 + @hono/vite-build |
| Processus | PM2 (dev sandbox) |

---

## 📊 Données cartographiques (Touba)

- **12 points de collecte** géoréférencés (coordonnées GPS réelles)
- **6 sources de déchets** (restaurants et cuisines dahiras)
- **3 projets de valorisation** (WACA, ENDA Énergie, Comité Magal)
- Centre de la carte : `14.866°N, 15.878°W` (Grande Mosquée de Touba)

---

## 🔧 Développement local

```bash
# Cloner et installer
git clone <repo>
cd webapp && npm install

# Build
npm run build

# Démarrer (via PM2)
pm2 start ecosystem.config.cjs

# Accéder
open http://localhost:3000
```

---

## 📈 Prochaines étapes recommandées

1. **Intégration QGIS Server** : Export/import de couches .shp et .geojson
2. **Base de données Cloudflare D1** : Persistance et mise à jour dynamique des données
3. **Application mobile** : Saisie terrain des agents de collecte (PWA)
4. **Intégration GPS temps réel** : Suivi des camions de collecte via API TracCar
5. **Alertes automatiques** : Notification quand taux de remplissage > 80%
6. **Export QGIS** : Génération de rapports cartographiques PDF
7. **Tableau de bord analytique** : Graphiques de tendances et prédictions

---

## 🏛️ Partenaires institutionnels

- **Mairie de Touba** — Gestion municipale
- **Comité d'Organisation du Magal** — Coordination événementielle  
- **CADAK-CAR** — Collecte des déchets
- **Projet WACA** — Compostage
- **ENDA Énergie** — Unité biogaz
- **ONG Green Touba** — Sensibilisation environnementale

---

## 📋 Statut du déploiement

- **Plateforme** : Cloudflare Pages
- **Statut** : ✅ Opérationnel
- **URL publique** : https://3000-i62ebd6n5cvu00c9kcy1r-2e1b9533.sandbox.novita.ai
- **Dernière mise à jour** : 2026-06-25
