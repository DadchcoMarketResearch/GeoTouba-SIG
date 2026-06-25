# GeoTouba — Portail SIG Déchets Organiques
**Plateforme de cartographie interactive pour l'identification et la gestion des points de collecte des déchets organiques dans la ville de Touba, Sénégal**

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
