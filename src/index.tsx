import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

const app = new Hono()

app.use('/api/*', cors())
app.use('/static/*', serveStatic({ root: './public' }))

// ─── API : Points de collecte ───────────────────────────────────────────────
app.get('/api/points-collecte', (c) => {
  const points = getPointsCollecte()
  const type = c.req.query('type')
  const statut = c.req.query('statut')
  const phase = c.req.query('phase')

  let filtered = points
  if (type) filtered = filtered.filter((p) => p.type === type)
  if (statut) filtered = filtered.filter((p) => p.statut === statut)
  if (phase) filtered = filtered.filter((p) => p.phase_active?.includes(phase))

  return c.json({ success: true, count: filtered.length, data: filtered })
})

app.get('/api/points-collecte/:id', (c) => {
  const id = parseInt(c.req.param('id'))
  const point = getPointsCollecte().find((p) => p.id === id)
  if (!point) return c.json({ success: false, message: 'Point introuvable' }, 404)
  return c.json({ success: true, data: point })
})

// ─── API : Restaurants / Sources déchets ────────────────────────────────────
app.get('/api/restaurants', (c) => {
  return c.json({ success: true, data: getRestaurants() })
})

// ─── API : Projets de valorisation ──────────────────────────────────────────
app.get('/api/projets', (c) => {
  return c.json({ success: true, data: getProjets() })
})

// ─── API : Statistiques ─────────────────────────────────────────────────────
app.get('/api/stats', (c) => {
  const points = getPointsCollecte()
  const actifs = points.filter((p) => p.statut === 'actif').length
  const capaciteTotale = points.reduce((s, p) => s + (p.capacite_m3 || 0), 0)
  const remplissageMoyen =
    points.reduce((s, p) => s + (p.taux_remplissage || 0), 0) / points.length

  return c.json({
    success: true,
    data: {
      total_points: points.length,
      actifs,
      inactifs: points.length - actifs,
      capacite_totale_m3: Math.round(capaciteTotale * 10) / 10,
      remplissage_moyen_pct: Math.round(remplissageMoyen),
      derniere_maj: new Date().toISOString(),
      phase_magal: getPhaseMagal(),
    },
  })
})

// ─── API : Protocole Magal ───────────────────────────────────────────────────
app.get('/api/protocole-magal', (c) => {
  return c.json({ success: true, data: getProtocoleMagal() })
})

// ─── Serve de l'application principale ──────────────────────────────────────
app.get('/', (c) => {
  return c.html(getMainHtml())
})

app.get('/carte', (c) => {
  return c.html(getMainHtml())
})

export default app

// ═══════════════════════════════════════════════════════════════════════════
// DONNÉES : Points de collecte (coordonnées réelles Touba, Sénégal)
// ═══════════════════════════════════════════════════════════════════════════
function getPhaseMagal(): string {
  const now = new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()
  // Magal de Touba : approximativement 18ème jour de Safar (calendrier hégirien)
  // En 2025 : ~octobre. Simulation basée sur période de l'année
  if (month === 9 && day >= 15) return 'pre-magal'
  if (month === 10 && day <= 5) return 'magal'
  if (month === 10 && day >= 6 && day <= 20) return 'post-magal'
  return 'normale'
}

function getPointsCollecte() {
  return [
    // ─── BACS À ORDURES CENTRAUX ────────────────────────────────────────
    {
      id: 1,
      nom: 'Bac Central Marché Ocas',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8658,
      lng: -15.878,
      adresse: 'Marché Ocas, Touba',
      quartier: 'Centre Touba',
      capacite_m3: 8,
      taux_remplissage: 72,
      frequence_collecte: 'Quotidienne',
      responsable: 'Mairie de Touba',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 06:30',
      prochaine_collecte: '2026-06-25 06:30',
      types_dechets: ['Déchets alimentaires', 'Résidus végétaux', 'Déchets de marché'],
      coordonnees_gps: '14.8658°N, 15.8780°W',
      photos: [],
      notes: 'Point stratégique proche du grand marché. Saturation fréquente lors du Magal.',
    },
    {
      id: 2,
      nom: 'Bac Mosquée Serigne Touba',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8696,
      lng: -15.8814,
      adresse: 'Proximité Grande Mosquée, Touba',
      quartier: 'Darou Khoudoss',
      capacite_m3: 12,
      taux_remplissage: 58,
      frequence_collecte: '2x/jour (Magal)',
      responsable: 'Dahira Matlaboul Fawzaïni',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 08:00',
      prochaine_collecte: '2026-06-24 20:00',
      types_dechets: ['Déchets alimentaires', 'Restes de repas communautaires'],
      coordonnees_gps: '14.8696°N, 15.8814°W',
      photos: [],
      notes: 'Zone à très haute densité lors du Magal. Renforcement prévu x3.',
    },
    {
      id: 3,
      nom: 'Point Collecte Darou Marnane',
      type: 'point_apport_volontaire',
      statut: 'actif',
      lat: 14.876,
      lng: -15.872,
      adresse: 'Quartier Darou Marnane',
      quartier: 'Darou Marnane',
      capacite_m3: 5,
      taux_remplissage: 45,
      frequence_collecte: '3x/semaine',
      responsable: 'Comité de Quartier',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-23 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Déchets ménagers organiques', 'Résidus de cuisine'],
      coordonnees_gps: '14.8760°N, 15.8720°W',
      photos: [],
      notes: 'Géré par les habitants. Bonne pratique de tri à la source.',
    },
    {
      id: 4,
      nom: 'Bac Quartier Gouye Mbind',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.862,
      lng: -15.884,
      adresse: 'Rue principale, Gouye Mbind',
      quartier: 'Gouye Mbind',
      capacite_m3: 6,
      taux_remplissage: 83,
      frequence_collecte: 'Quotidienne',
      responsable: 'CADAK-CAR',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 05:00',
      prochaine_collecte: '2026-06-25 05:00',
      types_dechets: ['Ordures ménagères', 'Déchets organiques', 'Résidus animaux'],
      coordonnees_gps: '14.8620°N, 15.8840°W',
      photos: [],
      notes: 'Taux de remplissage élevé. Nécessite passage supplémentaire.',
    },
    {
      id: 5,
      nom: 'Plateforme Compostage Keur Niang',
      type: 'plateforme_compostage',
      statut: 'actif',
      lat: 14.858,
      lng: -15.892,
      adresse: 'Zone périphérique, Keur Niang',
      quartier: 'Keur Niang',
      capacite_m3: 120,
      taux_remplissage: 35,
      frequence_collecte: 'Hebdomadaire',
      responsable: 'Projet WACA / ONG Green Touba',
      phase_active: ['normale', 'post-magal'],
      derniere_collecte: '2026-06-21 08:00',
      prochaine_collecte: '2026-06-28 08:00',
      types_dechets: ['Déchets verts', 'Matières organiques', 'Fumier animal'],
      coordonnees_gps: '14.8580°N, 15.8920°W',
      photos: [],
      notes: 'Site de valorisation compost. Production ~2 tonnes/semaine. Vente aux maraîchers.',
    },
    {
      id: 6,
      nom: 'Centre Tri Darou Khoudoss',
      type: 'centre_tri',
      statut: 'actif',
      lat: 14.874,
      lng: -15.879,
      adresse: 'Route de Mbacké, Darou Khoudoss',
      quartier: 'Darou Khoudoss',
      capacite_m3: 80,
      taux_remplissage: 50,
      frequence_collecte: 'Quotidienne',
      responsable: 'Mairie de Touba + Partenaire privé',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 04:00',
      prochaine_collecte: '2026-06-25 04:00',
      types_dechets: ['Tous types après tri', 'Fraction organique séparée'],
      coordonnees_gps: '14.8740°N, 15.8790°W',
      photos: [],
      notes: 'Centre principal de tri. Capacité de tri : 30 tonnes/jour.',
    },
    {
      id: 7,
      nom: 'Bac Quartier Ndamatou',
      type: 'bac_ordures',
      statut: 'inactif',
      lat: 14.868,
      lng: -15.868,
      adresse: 'Ndamatou Nord',
      quartier: 'Ndamatou',
      capacite_m3: 4,
      taux_remplissage: 0,
      frequence_collecte: 'En maintenance',
      responsable: 'Mairie de Touba',
      phase_active: ['pre-magal', 'magal'],
      derniere_collecte: '2026-06-20 06:00',
      prochaine_collecte: 'Après maintenance',
      types_dechets: ['Déchets ménagers organiques'],
      coordonnees_gps: '14.8680°N, 15.8680°W',
      photos: [],
      notes: 'En maintenance. Remise en service prévue avant le Magal.',
    },
    {
      id: 8,
      nom: 'Point Collecte Gare Routière',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.872,
      lng: -15.875,
      adresse: 'Gare Routière de Touba',
      quartier: 'Centre Touba',
      capacite_m3: 10,
      taux_remplissage: 91,
      frequence_collecte: '2x/jour',
      responsable: 'CETOM',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 10:00',
      prochaine_collecte: '2026-06-24 22:00',
      types_dechets: ['Déchets de voyage', 'Restes alimentaires', 'Déchets divers'],
      coordonnees_gps: '14.8720°N, 15.8750°W',
      photos: [],
      notes: 'CRITIQUE : Saturation quasi-permanente. Passage urgent nécessaire.',
    },
    {
      id: 9,
      nom: 'Bac Marché Bétail Touba',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.856,
      lng: -15.871,
      adresse: 'Marché à bétail, périphérie Sud',
      quartier: 'Sud Touba',
      capacite_m3: 15,
      taux_remplissage: 62,
      frequence_collecte: 'Quotidienne',
      responsable: 'Services Vétérinaires + Mairie',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 07:30',
      prochaine_collecte: '2026-06-25 07:30',
      types_dechets: ['Fumier', 'Résidus organiques animaux', 'Déchets verts'],
      coordonnees_gps: '14.8560°N, 15.8710°W',
      photos: [],
      notes: 'Source importante de biomasse valorisable pour le biogaz.',
    },
    {
      id: 10,
      nom: 'Point PAV Université Touba',
      type: 'point_apport_volontaire',
      statut: 'actif',
      lat: 14.882,
      lng: -15.869,
      adresse: 'Campus Université Cheikhoul Khadim',
      quartier: 'Nord Touba',
      capacite_m3: 3,
      taux_remplissage: 28,
      frequence_collecte: '3x/semaine',
      responsable: 'Club Environnement UCK',
      phase_active: ['normale'],
      derniere_collecte: '2026-06-23 12:00',
      prochaine_collecte: '2026-06-25 12:00',
      types_dechets: ['Déchets de restauration universitaire', 'Résidus organiques'],
      coordonnees_gps: '14.8820°N, 15.8690°W',
      photos: [],
      notes: "Initiative étudiante. Lié au projet de jardin compost de l'université.",
    },
    {
      id: 11,
      nom: 'Unité Biogaz Mbacké Road',
      type: 'unite_biogaz',
      statut: 'actif',
      lat: 14.852,
      lng: -15.898,
      adresse: 'Route de Mbacké, km 3',
      quartier: 'Périphérie Ouest',
      capacite_m3: 200,
      taux_remplissage: 42,
      frequence_collecte: 'Quotidienne',
      responsable: 'Projet ENDA Énergie',
      phase_active: ['normale', 'post-magal'],
      derniere_collecte: '2026-06-24 06:00',
      prochaine_collecte: '2026-06-25 06:00',
      types_dechets: ['Déchets organiques mixtes', 'Lisier', 'Graisses alimentaires'],
      coordonnees_gps: '14.8520°N, 15.8980°W',
      photos: [],
      notes: "Unité pilote biogaz. Production d'énergie pour ~50 foyers.",
    },
    {
      id: 12,
      nom: 'Bac Quartier Touba Mosquée',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.866,
      lng: -15.883,
      adresse: 'Touba Mosquée, rue des daharas',
      quartier: 'Touba Mosquée',
      capacite_m3: 8,
      taux_remplissage: 55,
      frequence_collecte: 'Quotidienne',
      responsable: 'Dahira locale',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Déchets de cuisine', 'Résidus organiques', 'Déchets daharas'],
      coordonnees_gps: '14.8660°N, 15.8830°W',
      photos: [],
      notes: 'Proche des grandes daharas. Flux organique important lors des zawiyahs.',
    },
  ]
}

function getRestaurants() {
  return [
    {
      id: 1,
      nom: 'Restaurant Thiéboudienne Ocas',
      type: 'restaurant_populaire',
      lat: 14.8665,
      lng: -15.877,
      quartier: 'Centre Touba',
      capacite_couverts: 200,
      dechets_estimes_kg_jour: 45,
      collecte_partenaire: true,
      contact: '+221 77 XXX XXXX',
    },
    {
      id: 2,
      nom: 'Gargote Marché Central',
      type: 'gargote',
      lat: 14.8651,
      lng: -15.8795,
      quartier: 'Centre Touba',
      capacite_couverts: 80,
      dechets_estimes_kg_jour: 20,
      collecte_partenaire: false,
      contact: null,
    },
    {
      id: 3,
      nom: 'Restaurant Darou Khoudoss',
      type: 'restaurant_populaire',
      lat: 14.8735,
      lng: -15.881,
      quartier: 'Darou Khoudoss',
      capacite_couverts: 150,
      dechets_estimes_kg_jour: 35,
      collecte_partenaire: true,
      contact: '+221 76 XXX XXXX',
    },
    {
      id: 4,
      nom: 'Cuisine communautaire Dahira',
      type: 'cuisine_dahira',
      lat: 14.8701,
      lng: -15.8808,
      quartier: 'Darou Khoudoss',
      capacite_couverts: 500,
      dechets_estimes_kg_jour: 120,
      collecte_partenaire: true,
      contact: '+221 77 XXX XXXX',
    },
    {
      id: 5,
      nom: 'Restaurant Gare Routière',
      type: 'restaurant_populaire',
      lat: 14.8718,
      lng: -15.8748,
      quartier: 'Centre Touba',
      capacite_couverts: 100,
      dechets_estimes_kg_jour: 28,
      collecte_partenaire: false,
      contact: null,
    },
    {
      id: 6,
      nom: 'Espace Restauration Ndamatou',
      type: 'fast_food_local',
      lat: 14.8672,
      lng: -15.867,
      quartier: 'Ndamatou',
      capacite_couverts: 60,
      dechets_estimes_kg_jour: 15,
      collecte_partenaire: false,
      contact: null,
    },
  ]
}

function getProjets() {
  return [
    {
      id: 1,
      nom: 'Projet Compostage WACA',
      type: 'compostage',
      statut: 'en_cours',
      lat: 14.858,
      lng: -15.892,
      partenaires: ['WACA', 'Mairie de Touba', 'ONG Green Touba'],
      budget_fcfa: 45000000,
      debut: '2024-01',
      fin_prevue: '2026-12',
      beneficiaires: '500 ménages',
      description: 'Production de compost à partir des déchets organiques du marché et des ménages.',
    },
    {
      id: 2,
      nom: 'Unité Pilote Biogaz ENDA',
      type: 'biogaz',
      statut: 'en_cours',
      lat: 14.852,
      lng: -15.898,
      partenaires: ['ENDA Énergie', 'GIZ', 'Mairie de Touba'],
      budget_fcfa: 120000000,
      debut: '2023-06',
      fin_prevue: '2027-06',
      beneficiaires: '200 foyers',
      description: 'Production de biogaz domestique à partir des déchets organiques et du fumier.',
    },
    {
      id: 3,
      nom: 'Collecte Sélective Magal',
      type: 'collecte_selective',
      statut: 'planifie',
      lat: 14.8696,
      lng: -15.8814,
      partenaires: ['Comité Magal', 'Mairie', 'Dahiras'],
      budget_fcfa: 25000000,
      debut: '2026-09',
      fin_prevue: '2026-10',
      beneficiaires: '3 millions pèlerins',
      description: 'Dispositif renforcé de collecte sélective organique pendant le Grand Magal.',
    },
  ]
}

function getProtocoleMagal() {
  return {
    phases: [
      {
        nom: 'Pré-Magal',
        periode: 'J-30 à J-1',
        couleur: '#f59e0b',
        actions: [
          'Recensement et cartographie de tous les points de collecte',
          'Vérification et maintenance des bacs existants',
          'Installation de 150 bacs supplémentaires dans les zones à fort flux',
          'Formation des équipes de collecte (250 agents)',
          'Signature des conventions avec les grandes daharas',
          'Mise à jour de la carte SIG avec nouveaux points',
          'Test des circuits de collecte renforcés',
          'Approvisionnement en matériel (sacs, gants, véhicules)',
          'Communication auprès des pèlerins et organisateurs',
        ],
        indicateurs: [
          'Nombre de bacs installés vs objectif',
          'Taux de couverture cartographique',
          "Nombre d'agents formés",
        ],
      },
      {
        nom: 'Pendant le Magal',
        periode: 'J0 à J+3',
        couleur: '#ef4444',
        actions: [
          'Collecte quotidienne intensifiée (2-4x/jour dans les zones centrales)',
          'Veille permanente via tableau de bord SIG (H24)',
          'Mise à jour en temps réel du taux de remplissage des bacs',
          'Déploiement de 30 camions de collecte supplémentaires',
          'Coordination des équipes via la carte SIG mobile',
          'Points de collecte temporaires autour des zones de repas communautaires',
          'Traçabilité GPS des véhicules de collecte',
          "Signalement immédiat des bacs saturés (<1h d'intervention)",
          'Documentation photographique pour le rapport post-Magal',
        ],
        indicateurs: [
          'Tonnage collecté / jour',
          'Délai moyen de vidange des bacs',
          "Nombre d'incidents de débordement",
          'Couverture zones critiques',
        ],
      },
      {
        nom: 'Post-Magal',
        periode: 'J+4 à J+30',
        couleur: '#10b981',
        actions: [
          'Opération de nettoyage général de la ville',
          'Retrait des bacs temporaires et inventaire du matériel',
          'Traitement/valorisation du surplus de déchets organiques',
          'Orientation des déchets organiques vers la plateforme de compostage',
          "Bilan quantitatif et qualitatif (rapport d'évaluation)",
          'Mise à jour de la base de données SIG',
          'Archivage des données cartographiques du Magal',
          "Réunion de retour d'expérience avec toutes les parties prenantes",
          'Ajustement du protocole pour le prochain Magal',
        ],
        indicateurs: [
          'Tonnage total collecté sur la période',
          'Taux de valorisation des déchets organiques',
          "Coût global de l'opération",
          "Satisfaction des parties prenantes",
        ],
      },
    ],
    contacts_urgence: [
      { role: 'Coordinateur SIG', nom: 'À nommer', tel: '+221 XX XXX XXXX' },
      { role: 'Chef opérations collecte', nom: 'À nommer', tel: '+221 XX XXX XXXX' },
      { role: 'Comité Magal Environnement', nom: 'À nommer', tel: '+221 XX XXX XXXX' },
    ],
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HTML PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
function getMainHtml(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SIG Déchets Organiques - Touba, Sénégal</title>

  <!-- Leaflet CSS -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <!-- FontAwesome -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"/>
  <!-- Google Fonts -->
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Amiri:wght@400;700&display=swap" rel="stylesheet"/>

  <style>
    :root {
      --primary: #16a34a;
      --primary-dark: #15803d;
      --primary-light: #bbf7d0;
      --secondary: #0891b2;
      --accent: #f59e0b;
      --danger: #ef4444;
      --warning: #f97316;
      --dark: #1a1a2e;
      --sidebar-bg: #0f172a;
      --sidebar-width: 340px;
      --header-h: 64px;
      --radius: 12px;
      --shadow: 0 4px 24px rgba(0,0,0,0.15);
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; font-family: 'Inter', sans-serif; background: #f0fdf4; }

    /* ── HEADER ─────────────────────────────────────────────── */
    #header {
      position: fixed; top: 0; left: 0; right: 0; height: var(--header-h);
      background: linear-gradient(135deg, var(--sidebar-bg) 0%, #1e3a2f 100%);
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 20px; z-index: 1100; box-shadow: 0 2px 20px rgba(0,0,0,0.4);
    }
    .header-brand { display: flex; align-items: center; gap: 12px; }
    .header-logo {
      width: 40px; height: 40px; border-radius: 10px;
      background: var(--primary); display: flex; align-items: center;
      justify-content: center; font-size: 20px;
    }
    .header-title { color: #fff; }
    .header-title h1 { font-size: 16px; font-weight: 700; letter-spacing: 0.3px; }
    .header-title p { font-size: 11px; color: #94a3b8; }
    .header-badges { display: flex; gap: 8px; }
    .badge {
      padding: 4px 12px; border-radius: 20px; font-size: 11px;
      font-weight: 600; display: flex; align-items: center; gap: 5px;
    }
    .badge-live { background: rgba(16,185,129,0.2); color: #10b981; border: 1px solid #10b981; }
    .badge-magal { background: rgba(245,158,11,0.2); color: #f59e0b; border: 1px solid #f59e0b; }
    .badge-dot { width: 7px; height: 7px; border-radius: 50%; animation: pulse 2s infinite; }
    .badge-dot-green { background: #10b981; }
    @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }

    /* ── LAYOUT ─────────────────────────────────────────────── */
    #app {
      display: flex; height: 100vh;
      padding-top: var(--header-h);
    }
    #sidebar {
      width: var(--sidebar-width); background: var(--sidebar-bg);
      overflow-y: auto; display: flex; flex-direction: column;
      transition: transform 0.3s; z-index: 900;
      scrollbar-width: thin; scrollbar-color: #334155 transparent;
    }
    #map-container { flex: 1; position: relative; }
    #map { width: 100%; height: 100%; }

    /* ── SIDEBAR SECTIONS ───────────────────────────────────── */
    .sidebar-section { padding: 16px; border-bottom: 1px solid #1e293b; }
    .sidebar-section-title {
      color: #94a3b8; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px;
      display: flex; align-items: center; gap: 6px;
    }
    .sidebar-section-title::before {
      content: ''; width: 3px; height: 12px;
      background: var(--primary); border-radius: 2px;
    }

    /* ── STATS CARDS ────────────────────────────────────────── */
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .stat-card {
      background: #1e293b; border-radius: 10px; padding: 12px;
      border: 1px solid #334155;
    }
    .stat-value { font-size: 22px; font-weight: 800; color: #fff; }
    .stat-label { font-size: 10px; color: #64748b; margin-top: 2px; }
    .stat-card.primary .stat-value { color: var(--primary); }
    .stat-card.warning .stat-value { color: var(--accent); }
    .stat-card.danger .stat-value { color: var(--danger); }
    .stat-card.info .stat-value { color: var(--secondary); }

    /* ── PHASE MAGAL INDICATOR ──────────────────────────────── */
    .phase-indicator {
      background: #1e293b; border-radius: 10px; padding: 12px;
      border-left: 4px solid var(--accent); margin-bottom: 12px;
    }
    .phase-indicator.normale { border-color: var(--primary); }
    .phase-indicator.pre-magal { border-color: var(--accent); }
    .phase-indicator.magal { border-color: var(--danger); }
    .phase-indicator.post-magal { border-color: var(--secondary); }
    .phase-name { color: #fff; font-weight: 700; font-size: 13px; }
    .phase-desc { color: #64748b; font-size: 11px; margin-top: 3px; }

    /* ── FILTERS ────────────────────────────────────────────── */
    .filter-group { margin-bottom: 12px; }
    .filter-label { color: #94a3b8; font-size: 11px; margin-bottom: 6px; display: block; }
    .filter-select {
      width: 100%; background: #1e293b; border: 1px solid #334155;
      color: #e2e8f0; padding: 8px 10px; border-radius: 8px;
      font-size: 12px; cursor: pointer; font-family: inherit;
    }
    .filter-select:focus { outline: none; border-color: var(--primary); }
    .filter-toggle-group { display: flex; flex-wrap: wrap; gap: 6px; }
    .filter-toggle {
      padding: 5px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;
      border: 1px solid #334155; background: #1e293b; color: #94a3b8;
      cursor: pointer; transition: all 0.2s;
    }
    .filter-toggle.active { background: var(--primary); border-color: var(--primary); color: #fff; }
    .filter-toggle:hover { border-color: var(--primary); color: #fff; }

    /* ── LAYER CONTROLS ─────────────────────────────────────── */
    .layer-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 0; border-bottom: 1px solid #1e293b;
    }
    .layer-info { display: flex; align-items: center; gap: 8px; }
    .layer-dot { width: 10px; height: 10px; border-radius: 50%; }
    .layer-name { color: #e2e8f0; font-size: 12px; }
    .toggle-switch {
      position: relative; width: 36px; height: 20px; cursor: pointer;
    }
    .toggle-switch input { display: none; }
    .toggle-slider {
      position: absolute; inset: 0; background: #334155;
      border-radius: 20px; transition: 0.3s;
    }
    .toggle-slider::before {
      content: ''; position: absolute; width: 14px; height: 14px;
      background: #fff; border-radius: 50%; left: 3px; top: 3px; transition: 0.3s;
    }
    .toggle-switch input:checked + .toggle-slider { background: var(--primary); }
    .toggle-switch input:checked + .toggle-slider::before { transform: translateX(16px); }

    /* ── LEGEND ─────────────────────────────────────────────── */
    .legend-items { display: flex; flex-direction: column; gap: 6px; }
    .legend-item { display: flex; align-items: center; gap: 8px; }
    .legend-icon { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
    .legend-text { color: #cbd5e1; font-size: 11px; }

    /* ── POINTS LIST ────────────────────────────────────────── */
    #points-list { }
    .point-item {
      background: #1e293b; border-radius: 8px; padding: 10px 12px;
      margin-bottom: 6px; cursor: pointer; border: 1px solid #334155;
      transition: all 0.2s; display: flex; align-items: center; gap: 10px;
    }
    .point-item:hover { border-color: var(--primary); background: #243548; }
    .point-item.selected { border-color: var(--primary); background: #1a3a28; }
    .point-item-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
    .point-item-info { flex: 1; min-width: 0; }
    .point-item-name { color: #e2e8f0; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .point-item-sub { color: #64748b; font-size: 10px; margin-top: 2px; }
    .fill-bar { height: 4px; border-radius: 2px; background: #334155; margin-top: 5px; overflow: hidden; }
    .fill-bar-inner { height: 100%; border-radius: 2px; transition: width 0.5s; }
    .fill-low { background: var(--primary); }
    .fill-med { background: var(--accent); }
    .fill-high { background: var(--danger); }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .status-active { background: var(--primary); }
    .status-inactive { background: #475569; }

    /* ── POPUP / FICHE DÉTAIL ───────────────────────────────── */
    #detail-panel {
      position: absolute; top: 0; right: 0; bottom: 0;
      width: 380px; background: #fff; z-index: 800;
      transform: translateX(100%); transition: transform 0.35s cubic-bezier(.4,0,.2,1);
      overflow-y: auto; box-shadow: -4px 0 30px rgba(0,0,0,0.2);
    }
    #detail-panel.open { transform: translateX(0); }
    .detail-header {
      background: linear-gradient(135deg, var(--primary) 0%, #065f46 100%);
      padding: 20px; color: #fff; position: relative;
    }
    .detail-type-badge {
      display: inline-flex; align-items: center; gap: 5px;
      background: rgba(255,255,255,0.2); padding: 4px 10px;
      border-radius: 20px; font-size: 11px; font-weight: 600; margin-bottom: 10px;
    }
    .detail-title { font-size: 17px; font-weight: 700; margin-bottom: 4px; }
    .detail-address { font-size: 12px; opacity: 0.85; }
    .detail-close {
      position: absolute; top: 14px; right: 14px;
      background: rgba(255,255,255,0.2); border: none; color: #fff;
      width: 30px; height: 30px; border-radius: 50%; cursor: pointer;
      font-size: 14px; display: flex; align-items: center; justify-content: center;
    }
    .detail-body { padding: 20px; }
    .detail-kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }
    .detail-kpi {
      background: #f8fafc; border-radius: 10px; padding: 12px;
      border: 1px solid #e2e8f0; text-align: center;
    }
    .detail-kpi-val { font-size: 20px; font-weight: 800; color: var(--dark); }
    .detail-kpi-lbl { font-size: 10px; color: #94a3b8; margin-top: 2px; }
    .fill-indicator { margin: 16px 0; }
    .fill-label-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px; font-weight: 600; }
    .fill-track { height: 12px; background: #e2e8f0; border-radius: 6px; overflow: hidden; }
    .fill-progress { height: 100%; border-radius: 6px; transition: width 0.8s; }
    .detail-section-title { font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin: 16px 0 8px; display: flex; align-items: center; gap: 6px; }
    .tag { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 20px; font-size: 11px; font-weight: 500; margin: 2px; }
    .tag-organic { background: #dcfce7; color: #16a34a; }
    .tag-phase { background: #fef3c7; color: #d97706; }
    .detail-info-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 12px; color: #374151; }
    .detail-info-row i { color: var(--primary); width: 16px; flex-shrink: 0; margin-top: 1px; }
    .detail-info-label { color: #94a3b8; min-width: 80px; }
    .detail-note { background: #fffbeb; border-left: 3px solid var(--accent); padding: 10px 12px; border-radius: 0 8px 8px 0; font-size: 12px; color: #78350f; margin-top: 12px; }
    .btn-action {
      width: 100%; padding: 10px; border-radius: 8px; border: none;
      font-size: 13px; font-weight: 600; cursor: pointer; display: flex;
      align-items: center; justify-content: center; gap: 6px; transition: all 0.2s;
      margin-bottom: 8px;
    }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-primary:hover { background: var(--primary-dark); }
    .btn-outline { background: transparent; color: var(--primary); border: 1.5px solid var(--primary); }
    .btn-outline:hover { background: #f0fdf4; }

    /* ── PROTOCOLE MAGAL PANEL ──────────────────────────────── */
    #protocole-panel {
      position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
      width: calc(100% - 60px); max-width: 800px;
      background: #fff; border-radius: var(--radius); box-shadow: var(--shadow);
      z-index: 700; display: none;
    }
    #protocole-panel.visible { display: block; }
    .proto-header {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      padding: 16px 20px; border-radius: var(--radius) var(--radius) 0 0;
      display: flex; align-items: center; justify-content: space-between;
    }
    .proto-title { color: #fff; font-size: 14px; font-weight: 700; }
    .proto-close { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 16px; }
    .proto-phases { display: grid; grid-template-columns: repeat(3,1fr); gap: 0; }
    .proto-phase { padding: 16px; border-right: 1px solid #f1f5f9; }
    .proto-phase:last-child { border-right: none; }
    .proto-phase-title {
      font-size: 13px; font-weight: 700; margin-bottom: 6px;
      display: flex; align-items: center; gap: 6px;
    }
    .proto-phase-period { font-size: 10px; color: #94a3b8; margin-bottom: 10px; }
    .proto-actions { list-style: none; }
    .proto-actions li {
      font-size: 11px; color: #374151; padding: 3px 0;
      display: flex; align-items: flex-start; gap: 5px;
    }
    .proto-actions li::before { content: '•'; color: var(--primary); flex-shrink: 0; }

    /* ── MAP CONTROLS ────────────────────────────────────────── */
    .map-fab {
      position: absolute; z-index: 800; background: #fff;
      border-radius: 10px; box-shadow: var(--shadow);
      border: none; cursor: pointer; display: flex; align-items: center;
      gap: 6px; padding: 10px 14px; font-size: 12px; font-weight: 600;
      color: var(--dark); transition: all 0.2s;
    }
    .map-fab:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,0,0,0.2); }
    #btn-protocole { bottom: 20px; right: 20px; background: var(--dark); color: #fff; }
    #btn-protocole i { color: var(--accent); }
    #btn-fullscreen { top: 80px; right: 20px; }
    #search-bar {
      position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
      z-index: 800; display: flex; align-items: center;
      background: #fff; border-radius: 30px; box-shadow: var(--shadow);
      padding: 8px 16px; gap: 8px; width: 340px;
    }
    #search-bar i { color: #94a3b8; }
    #search-input {
      border: none; outline: none; font-size: 13px; width: 100%;
      font-family: inherit;
    }

    /* ── LEAFLET CUSTOM MARKERS ─────────────────────────────── */
    .custom-marker {
      width: 36px; height: 36px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      border: 2.5px solid #fff; cursor: pointer;
    }
    .marker-bac { background: #16a34a; }
    .marker-pav { background: #0891b2; }
    .marker-compostage { background: #d97706; }
    .marker-centre-tri { background: #7c3aed; }
    .marker-biogaz { background: #db2777; }
    .marker-restaurant { background: #ea580c; }
    .marker-projet { background: #0d9488; }
    .marker-inactive { background: #64748b; opacity: 0.7; }

    /* ── REMPLISSAGE RING ────────────────────────────────────── */
    .fill-ring-marker {
      width: 42px; height: 42px; position: relative;
      display: flex; align-items: center; justify-content: center;
    }
    .fill-ring-svg { position: absolute; top: 0; left: 0; transform: rotate(-90deg); }
    .fill-ring-inner {
      width: 28px; height: 28px; border-radius: 50%;
      background: #fff; display: flex; align-items: center;
      justify-content: center; font-size: 13px; z-index: 1;
    }

    /* ── RESPONSIVE ─────────────────────────────────────────── */
    .sidebar-toggle {
      display: none; position: fixed; bottom: 80px; left: 20px;
      z-index: 1000; background: var(--primary); color: #fff;
      border: none; width: 48px; height: 48px; border-radius: 50%;
      font-size: 18px; cursor: pointer; box-shadow: var(--shadow);
    }
    @media (max-width: 768px) {
      :root { --sidebar-width: 100vw; }
      #sidebar {
        position: fixed; top: var(--header-h); left: 0; bottom: 0;
        transform: translateX(-100%); z-index: 1000;
      }
      #sidebar.open { transform: translateX(0); }
      .sidebar-toggle { display: flex; align-items: center; justify-content: center; }
      #detail-panel { width: 100%; }
      .proto-phases { grid-template-columns: 1fr; }
    }

    /* Scrollbar */
    #sidebar::-webkit-scrollbar { width: 4px; }
    #sidebar::-webkit-scrollbar-track { background: transparent; }
    #sidebar::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }

    /* Leaflet popup override */
    .leaflet-popup-content-wrapper { border-radius: 12px !important; box-shadow: 0 4px 20px rgba(0,0,0,0.15) !important; }
    .leaflet-popup-content { margin: 0 !important; padding: 0 !important; }
    .popup-content { padding: 14px 16px; }
    .popup-title { font-weight: 700; font-size: 13px; color: var(--dark); margin-bottom: 4px; }
    .popup-sub { font-size: 11px; color: #64748b; }
    .popup-fill { margin: 8px 0; }
    .popup-btn {
      background: var(--primary); color: #fff; border: none; border-radius: 6px;
      padding: 6px 12px; font-size: 11px; font-weight: 600; cursor: pointer;
      width: 100%; margin-top: 8px;
    }

    /* Animations */
    @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
    @keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
    .animate-in { animation: fadeIn 0.3s ease; }
  </style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════ HEADER -->
<header id="header">
  <div class="header-brand">
    <div class="header-logo">🗺️</div>
    <div class="header-title">
      <h1>GeoTouba — Déchets Organiques</h1>
      <p>Portail SIG · Ville de Touba, Sénégal</p>
    </div>
  </div>
  <div class="header-badges">
    <span class="badge badge-live">
      <span class="badge-dot badge-dot-green"></span>
      Données en direct
    </span>
    <span class="badge badge-magal" id="phase-badge">
      <i class="fas fa-calendar-alt"></i>
      Chargement...
    </span>
  </div>
</header>

<!-- ═══════════════════════════════════════════════════════════ APP -->
<div id="app">

  <!-- ─── SIDEBAR ─────────────────────────────────────────── -->
  <aside id="sidebar">

    <!-- Statistiques globales -->
    <div class="sidebar-section">
      <div class="sidebar-section-title"><i class="fas fa-chart-bar"></i> Tableau de bord</div>
      <div id="phase-indicator" class="phase-indicator normale">
        <div class="phase-name" id="phase-name-label">Chargement...</div>
        <div class="phase-desc" id="phase-desc-label"></div>
      </div>
      <div class="stats-grid" id="stats-grid">
        <div class="stat-card primary">
          <div class="stat-value" id="stat-total">—</div>
          <div class="stat-label">Points de collecte</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-value" id="stat-actifs">—</div>
          <div class="stat-label">Points actifs</div>
        </div>
        <div class="stat-card info">
          <div class="stat-value" id="stat-capacite">—</div>
          <div class="stat-label">Capacité totale (m³)</div>
        </div>
        <div class="stat-card danger">
          <div class="stat-value" id="stat-remplissage">—</div>
          <div class="stat-label">Remplissage moyen</div>
        </div>
      </div>
    </div>

    <!-- Filtres -->
    <div class="sidebar-section">
      <div class="sidebar-section-title"><i class="fas fa-filter"></i> Filtres</div>
      <div class="filter-group">
        <label class="filter-label">Type de point</label>
        <select class="filter-select" id="filter-type" onchange="applyFilters()">
          <option value="">Tous les types</option>
          <option value="bac_ordures">🗑️ Bacs à ordures</option>
          <option value="point_apport_volontaire">♻️ Points apport volontaire</option>
          <option value="plateforme_compostage">🌱 Plateformes compostage</option>
          <option value="centre_tri">🔄 Centres de tri</option>
          <option value="unite_biogaz">⚡ Unités biogaz</option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">Statut</label>
        <div class="filter-toggle-group">
          <button class="filter-toggle active" onclick="toggleStatus(this,'actif')">✅ Actifs</button>
          <button class="filter-toggle active" onclick="toggleStatus(this,'inactif')">⚠️ Inactifs</button>
        </div>
      </div>
      <div class="filter-group">
        <label class="filter-label">Phase Magal</label>
        <select class="filter-select" id="filter-phase" onchange="applyFilters()">
          <option value="">Toutes les phases</option>
          <option value="normale">📅 Période normale</option>
          <option value="pre-magal">🔔 Pré-Magal (J-30)</option>
          <option value="magal">🕌 Pendant le Magal</option>
          <option value="post-magal">✔️ Post-Magal</option>
        </select>
      </div>
    </div>

    <!-- Couches cartographiques -->
    <div class="sidebar-section">
      <div class="sidebar-section-title"><i class="fas fa-layer-group"></i> Couches cartographiques</div>
      <div class="layer-item">
        <div class="layer-info">
          <div class="layer-dot" style="background:#16a34a"></div>
          <span class="layer-name">Points de collecte</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="layer-collecte" checked onchange="toggleLayer('collecte')">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="layer-item">
        <div class="layer-info">
          <div class="layer-dot" style="background:#ea580c"></div>
          <span class="layer-name">Sources déchets (restaurants)</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="layer-restaurants" onchange="toggleLayer('restaurants')">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="layer-item">
        <div class="layer-info">
          <div class="layer-dot" style="background:#0d9488"></div>
          <span class="layer-name">Projets de valorisation</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="layer-projets" onchange="toggleLayer('projets')">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="layer-item">
        <div class="layer-info">
          <div class="layer-dot" style="background:#6366f1"></div>
          <span class="layer-name">Zones de chaleur (densité)</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="layer-heatmap" onchange="toggleLayer('heatmap')">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="layer-item">
        <div class="layer-info">
          <div class="layer-dot" style="background:#0891b2"></div>
          <span class="layer-name">Réseau routier (OSM)</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="layer-routes" onchange="toggleLayer('routes')">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <!-- Légende -->
    <div class="sidebar-section">
      <div class="sidebar-section-title"><i class="fas fa-map-legend"></i> Légende</div>
      <div class="legend-items">
        <div class="legend-item">
          <div class="legend-icon" style="background:#16a34a;color:#fff">🗑️</div>
          <span class="legend-text">Bac à ordures</span>
        </div>
        <div class="legend-item">
          <div class="legend-icon" style="background:#0891b2;color:#fff">♻️</div>
          <span class="legend-text">Point apport volontaire</span>
        </div>
        <div class="legend-item">
          <div class="legend-icon" style="background:#d97706;color:#fff">🌱</div>
          <span class="legend-text">Plateforme compostage</span>
        </div>
        <div class="legend-item">
          <div class="legend-icon" style="background:#7c3aed;color:#fff">🔄</div>
          <span class="legend-text">Centre de tri</span>
        </div>
        <div class="legend-item">
          <div class="legend-icon" style="background:#db2777;color:#fff">⚡</div>
          <span class="legend-text">Unité biogaz</span>
        </div>
        <div class="legend-item">
          <div class="legend-icon" style="background:#ea580c;color:#fff">🍽️</div>
          <span class="legend-text">Restaurant / Source déchets</span>
        </div>
        <div class="legend-item">
          <div class="legend-icon" style="background:#0d9488;color:#fff">🌿</div>
          <span class="legend-text">Projet de valorisation</span>
        </div>
        <div class="legend-item" style="margin-top:8px">
          <div style="display:flex;gap:4px">
            <div style="width:14px;height:14px;border-radius:2px;background:#16a34a"></div>
            <div style="width:14px;height:14px;border-radius:2px;background:#f59e0b"></div>
            <div style="width:14px;height:14px;border-radius:2px;background:#ef4444"></div>
          </div>
          <span class="legend-text">Remplissage faible / moyen / critique</span>
        </div>
      </div>
    </div>

    <!-- Liste des points -->
    <div class="sidebar-section">
      <div class="sidebar-section-title"><i class="fas fa-list"></i> Points de collecte (<span id="list-count">0</span>)</div>
      <div id="points-list"></div>
    </div>

  </aside>

  <!-- ─── MAP ─────────────────────────────────────────────── -->
  <div id="map-container">
    <div id="map"></div>

    <!-- Barre de recherche -->
    <div id="search-bar">
      <i class="fas fa-search"></i>
      <input type="text" id="search-input" placeholder="Rechercher un quartier, point..." oninput="searchPoints()"/>
    </div>

    <!-- Bouton Protocole Magal -->
    <button id="btn-protocole" class="map-fab" onclick="toggleProtocole()">
      <i class="fas fa-calendar-check"></i> Protocole Magal
    </button>

    <!-- Panel détail point -->
    <div id="detail-panel">
      <div id="detail-content"></div>
    </div>

    <!-- Panel Protocole Magal -->
    <div id="protocole-panel">
      <div class="proto-header">
        <span class="proto-title"><i class="fas fa-calendar-check" style="color:#f59e0b;margin-right:8px"></i>Protocole de mise à jour — Grand Magal de Touba</span>
        <button class="proto-close" onclick="toggleProtocole()"><i class="fas fa-times"></i></button>
      </div>
      <div class="proto-phases" id="proto-phases-content"></div>
    </div>
  </div>
</div>

<button class="sidebar-toggle" onclick="document.getElementById('sidebar').classList.toggle('open')">
  <i class="fas fa-bars"></i>
</button>

<!-- ═══════════════════════════════════════════════════════════ SCRIPTS -->
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script>
// ═══════════════════════════════════════════════════════════════════════
// ÉTAT GLOBAL
// ═══════════════════════════════════════════════════════════════════════
let map, allPoints = [], allRestaurants = [], allProjets = []
let layerGroups = { collecte: null, restaurants: null, projets: null, heatmap: null }
let activeFilters = { type: '', statut: ['actif', 'inactif'], phase: '' }
let selectedPointId = null

const TYPE_CONFIG = {
  bac_ordures:            { icon: '🗑️', color: '#16a34a', label: 'Bac à ordures' },
  point_apport_volontaire:{ icon: '♻️', color: '#0891b2', label: 'Point apport volontaire' },
  plateforme_compostage:  { icon: '🌱', color: '#d97706', label: 'Plateforme compostage' },
  centre_tri:             { icon: '🔄', color: '#7c3aed', label: 'Centre de tri' },
  unite_biogaz:           { icon: '⚡', color: '#db2777', label: 'Unité biogaz' },
}

const PHASE_CONFIG = {
  normale:    { label: 'Période normale', desc: 'Opérations standard de collecte', color: '#16a34a' },
  'pre-magal':{ label: 'Pré-Magal (J-30)', desc: 'Préparation et renforcement du dispositif', color: '#f59e0b' },
  magal:      { label: 'Grand Magal', desc: 'Dispositif maximum — 3 millions de pèlerins', color: '#ef4444' },
  'post-magal':{ label: 'Post-Magal', desc: 'Nettoyage général et valorisation', color: '#0891b2' },
}

// ═══════════════════════════════════════════════════════════════════════
// INITIALISATION CARTE
// ═══════════════════════════════════════════════════════════════════════
function initMap() {
  map = L.map('map', {
    center: [14.866, -15.878],
    zoom: 14,
    zoomControl: false
  })

  // Tuile de base OSM
  const osmLayer = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap contributors', maxZoom: 19 }
  )

  // Tuile satellite Esri
  const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: '© Esri', maxZoom: 19 }
  )

  // CartoDB Dark
  const darkLayer = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { attribution: '© CartoDB', maxZoom: 19 }
  )

  osmLayer.addTo(map)

  // Contrôle de zoom et couches de base
  L.control.zoom({ position: 'topright' }).addTo(map)
  L.control.layers(
    { '🗺️ Plan OSM': osmLayer, '🛰️ Satellite': satelliteLayer, '🌙 Sombre': darkLayer },
    {},
    { position: 'topright', collapsed: true }
  ).addTo(map)

  // Initialiser les groupes de couches
  layerGroups.collecte = L.layerGroup().addTo(map)
  layerGroups.restaurants = L.layerGroup()
  layerGroups.projets = L.layerGroup()
  layerGroups.heatmap = L.layerGroup()
}

// ═══════════════════════════════════════════════════════════════════════
// CRÉATION MARQUEURS
// ═══════════════════════════════════════════════════════════════════════
function createCollecteMarker(point) {
  const cfg = TYPE_CONFIG[point.type] || { icon: '📍', color: '#64748b', label: point.type }
  const inactive = point.statut !== 'actif'
  const fillColor = point.taux_remplissage > 80 ? '#ef4444'
    : point.taux_remplissage > 50 ? '#f59e0b' : '#16a34a'

  const html = \`
    <div class="fill-ring-marker" title="\${point.nom}">
      <svg class="fill-ring-svg" width="42" height="42" viewBox="0 0 42 42">
        <circle cx="21" cy="21" r="18" fill="none" stroke="\${inactive ? '#475569' : '#e2e8f0'}" stroke-width="4"/>
        \${!inactive ? \`<circle cx="21" cy="21" r="18" fill="none" stroke="\${fillColor}"
          stroke-width="4" stroke-dasharray="\${(point.taux_remplissage/100)*113.1} 113.1"
          stroke-linecap="round"/>\` : ''}
      </svg>
      <div class="fill-ring-inner" style="background:\${inactive ? '#475569' : cfg.color}">
        \${cfg.icon}
      </div>
    </div>
  \`

  const icon = L.divIcon({
    html, className: '', iconSize: [42, 42], iconAnchor: [21, 21]
  })

  const marker = L.marker([point.lat, point.lng], { icon })

  marker.bindPopup(() => {
    const fillColor2 = point.taux_remplissage > 80 ? '#ef4444'
      : point.taux_remplissage > 50 ? '#f59e0b' : '#16a34a'
    return \`
      <div class="popup-content">
        <div class="popup-title">\${cfg.icon} \${point.nom}</div>
        <div class="popup-sub">\${cfg.label} · \${point.quartier}</div>
        \${point.statut === 'actif' ? \`
          <div class="popup-fill">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;font-weight:600">
              <span>Remplissage</span>
              <span style="color:\${fillColor2}">\${point.taux_remplissage}%</span>
            </div>
            <div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden">
              <div style="width:\${point.taux_remplissage}%;height:100%;background:\${fillColor2};border-radius:4px"></div>
            </div>
          </div>
          <div style="font-size:11px;color:#64748b">📅 Prochaine collecte : \${point.prochaine_collecte}</div>
        \` : '<div style="color:#ef4444;font-size:11px;font-weight:600;margin-top:6px">⚠️ Point inactif (maintenance)</div>'}
        <button class="popup-btn" onclick="showDetail(\${point.id})">Voir la fiche complète →</button>
      </div>
    \`
  }, { maxWidth: 240, className: '' })

  marker.on('click', () => {
    selectPointInList(point.id)
  })

  return marker
}

function createRestaurantMarker(r) {
  const icon = L.divIcon({
    html: \`<div class="custom-marker marker-restaurant">🍽️</div>\`,
    className: '', iconSize: [36, 36], iconAnchor: [18, 18]
  })
  const m = L.marker([r.lat, r.lng], { icon })
  m.bindPopup(\`
    <div class="popup-content">
      <div class="popup-title">🍽️ \${r.nom}</div>
      <div class="popup-sub">\${r.quartier} · \${r.type.replace(/_/g,' ')}</div>
      <div style="font-size:11px;margin-top:8px;color:#374151">
        <div>👥 Capacité : \${r.capacite_couverts} couverts</div>
        <div>🗑️ Déchets estimés : <strong>\${r.dechets_estimes_kg_jour} kg/j</strong></div>
        <div style="margin-top:4px">Collecte partenaire : <strong style="color:\${r.collecte_partenaire?'#16a34a':'#ef4444'}">\${r.collecte_partenaire?'✅ Oui':'❌ Non'}</strong></div>
      </div>
    </div>
  \`, { maxWidth: 220 })
  return m
}

function createProjetMarker(p) {
  const icon = L.divIcon({
    html: \`<div class="custom-marker marker-projet">🌿</div>\`,
    className: '', iconSize: [36, 36], iconAnchor: [18, 18]
  })
  const m = L.marker([p.lat, p.lng], { icon })
  m.bindPopup(\`
    <div class="popup-content">
      <div class="popup-title">🌿 \${p.nom}</div>
      <div class="popup-sub">\${p.type.replace(/_/g,' ')} · Statut : <strong style="color:\${p.statut==='en_cours'?'#16a34a':'#f59e0b'}">\${p.statut.replace('_',' ')}</strong></div>
      <div style="font-size:11px;margin-top:8px;color:#374151">
        <div>👥 Bénéficiaires : \${p.beneficiaires}</div>
        <div>💰 Budget : \${(p.budget_fcfa/1000000).toFixed(0)} M FCFA</div>
        <div>📅 \${p.debut} → \${p.fin_prevue}</div>
        <div style="margin-top:6px;color:#64748b">\${p.description}</div>
      </div>
    </div>
  \`, { maxWidth: 260 })
  return m
}

// ═══════════════════════════════════════════════════════════════════════
// RENDU LISTE + MARKERS
// ═══════════════════════════════════════════════════════════════════════
function renderPoints(points) {
  layerGroups.collecte.clearLayers()
  const list = document.getElementById('points-list')
  const count = document.getElementById('list-count')
  list.innerHTML = ''
  count.textContent = points.length

  points.forEach(point => {
    // Marker
    const marker = createCollecteMarker(point)
    marker._pointId = point.id
    layerGroups.collecte.addLayer(marker)

    // List item
    const cfg = TYPE_CONFIG[point.type] || { icon: '📍', color: '#64748b' }
    const fillColor = point.taux_remplissage > 80 ? 'fill-high'
      : point.taux_remplissage > 50 ? 'fill-med' : 'fill-low'
    const item = document.createElement('div')
    item.className = \`point-item animate-in \${selectedPointId === point.id ? 'selected' : ''}\`
    item.dataset.id = point.id
    item.innerHTML = \`
      <div class="point-item-icon" style="background:\${point.statut==='actif'?cfg.color:'#475569'}">
        \${cfg.icon}
      </div>
      <div class="point-item-info">
        <div class="point-item-name">\${point.nom}</div>
        <div class="point-item-sub">\${point.quartier} · \${point.frequence_collecte}</div>
        \${point.statut === 'actif' ? \`
        <div class="fill-bar">
          <div class="fill-bar-inner \${fillColor}" style="width:\${point.taux_remplissage}%"></div>
        </div>\` : '<div style="font-size:10px;color:#ef4444;margin-top:3px">⚠️ Maintenance</div>'}
      </div>
      <div class="status-dot \${point.statut === 'actif' ? 'status-active' : 'status-inactive'}"></div>
    \`
    item.onclick = () => {
      flyToPoint(point)
      showDetail(point.id)
      selectPointInList(point.id)
    }
    list.appendChild(item)
  })
}

function flyToPoint(point) {
  map.flyTo([point.lat, point.lng], 16, { duration: 1.2 })
}

function selectPointInList(id) {
  selectedPointId = id
  document.querySelectorAll('.point-item').forEach(el => {
    el.classList.toggle('selected', parseInt(el.dataset.id) === id)
  })
}

// ═══════════════════════════════════════════════════════════════════════
// PANNEAU DÉTAIL
// ═══════════════════════════════════════════════════════════════════════
function showDetail(id) {
  const point = allPoints.find(p => p.id === id)
  if (!point) return
  const cfg = TYPE_CONFIG[point.type] || { icon: '📍', color: '#64748b', label: point.type }
  const fillColor = point.taux_remplissage > 80 ? '#ef4444'
    : point.taux_remplissage > 50 ? '#f59e0b' : '#16a34a'

  const phaseTags = (point.phase_active || []).map(ph => {
    const pc = PHASE_CONFIG[ph] || {}
    return \`<span class="tag tag-phase">\${pc.label || ph}</span>\`
  }).join('')

  const dechetTags = (point.types_dechets || []).map(d =>
    \`<span class="tag tag-organic">🌿 \${d}</span>\`
  ).join('')

  const html = \`
    <div class="detail-header" style="background:linear-gradient(135deg,\${cfg.color},\${cfg.color}cc)">
      <button class="detail-close" onclick="closeDetail()"><i class="fas fa-times"></i></button>
      <div class="detail-type-badge">\${cfg.icon} \${cfg.label}</div>
      <div class="detail-title">\${point.nom}</div>
      <div class="detail-address"><i class="fas fa-map-marker-alt" style="margin-right:5px"></i>\${point.adresse}</div>
    </div>
    <div class="detail-body">
      <div class="detail-kpi-grid">
        <div class="detail-kpi">
          <div class="detail-kpi-val">\${point.capacite_m3}</div>
          <div class="detail-kpi-lbl">Capacité (m³)</div>
        </div>
        <div class="detail-kpi">
          <div class="detail-kpi-val" style="color:\${fillColor}">\${point.taux_remplissage}%</div>
          <div class="detail-kpi-lbl">Remplissage actuel</div>
        </div>
      </div>

      \${point.statut === 'actif' ? \`
      <div class="fill-indicator">
        <div class="fill-label-row">
          <span>Taux de remplissage</span>
          <span style="color:\${fillColor}">\${point.taux_remplissage >= 80 ? '🔴 CRITIQUE' : point.taux_remplissage >= 50 ? '🟡 Moyen' : '🟢 Normal'}</span>
        </div>
        <div class="fill-track">
          <div class="fill-progress" style="width:\${point.taux_remplissage}%;background:\${fillColor}"></div>
        </div>
      </div>\` : ''}

      <div class="detail-section-title"><i class="fas fa-info-circle"></i> Informations</div>
      <div class="detail-info-row">
        <i class="fas fa-building"></i>
        <span class="detail-info-label">Quartier</span>
        <span>\${point.quartier}</span>
      </div>
      <div class="detail-info-row">
        <i class="fas fa-user-tie"></i>
        <span class="detail-info-label">Responsable</span>
        <span>\${point.responsable}</span>
      </div>
      <div class="detail-info-row">
        <i class="fas fa-clock"></i>
        <span class="detail-info-label">Fréquence</span>
        <span>\${point.frequence_collecte}</span>
      </div>
      <div class="detail-info-row">
        <i class="fas fa-history"></i>
        <span class="detail-info-label">Dernière</span>
        <span>\${point.derniere_collecte}</span>
      </div>
      <div class="detail-info-row">
        <i class="fas fa-calendar-check"></i>
        <span class="detail-info-label">Prochaine</span>
        <span>\${point.prochaine_collecte}</span>
      </div>
      <div class="detail-info-row">
        <i class="fas fa-map-pin"></i>
        <span class="detail-info-label">GPS</span>
        <span>\${point.coordonnees_gps}</span>
      </div>
      <div class="detail-info-row">
        <i class="fas fa-circle" style="color:\${point.statut==='actif'?'#16a34a':'#ef4444'}"></i>
        <span class="detail-info-label">Statut</span>
        <span style="font-weight:600;color:\${point.statut==='actif'?'#16a34a':'#ef4444'}">\${point.statut === 'actif' ? '✅ Actif' : '⚠️ Inactif'}</span>
      </div>

      <div class="detail-section-title"><i class="fas fa-leaf"></i> Types de déchets organiques</div>
      <div>\${dechetTags}</div>

      <div class="detail-section-title"><i class="fas fa-calendar-alt"></i> Phases d'activité</div>
      <div>\${phaseTags}</div>

      \${point.notes ? \`
      <div class="detail-note">
        <strong>📋 Notes :</strong> \${point.notes}
      </div>\` : ''}

      <div style="margin-top:16px">
        <button class="btn-action btn-primary" onclick="flyToPoint(allPoints.find(p=>p.id===\${point.id}))">
          <i class="fas fa-crosshairs"></i> Centrer sur la carte
        </button>
        <button class="btn-action btn-outline" onclick="exportPoint(\${point.id})">
          <i class="fas fa-download"></i> Exporter cette fiche
        </button>
      </div>
    </div>
  \`

  document.getElementById('detail-content').innerHTML = html
  document.getElementById('detail-panel').classList.add('open')
  selectPointInList(id)
}

function closeDetail() {
  document.getElementById('detail-panel').classList.remove('open')
  selectedPointId = null
  document.querySelectorAll('.point-item').forEach(el => el.classList.remove('selected'))
}

function exportPoint(id) {
  const point = allPoints.find(p => p.id === id)
  if (!point) return
  const data = JSON.stringify(point, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = \`fiche_\${point.nom.replace(/\\s+/g,'_')}.json\`
  a.click()
}

// ═══════════════════════════════════════════════════════════════════════
// PROTOCOLE MAGAL
// ═══════════════════════════════════════════════════════════════════════
function toggleProtocole() {
  document.getElementById('protocole-panel').classList.toggle('visible')
}

async function loadProtocole() {
  const resp = await axios.get('/api/protocole-magal')
  const { phases } = resp.data.data
  const container = document.getElementById('proto-phases-content')
  container.innerHTML = phases.map(ph => \`
    <div class="proto-phase">
      <div class="proto-phase-title" style="color:\${ph.couleur}">
        <span style="width:10px;height:10px;border-radius:50%;background:\${ph.couleur};display:inline-block"></span>
        \${ph.nom}
      </div>
      <div class="proto-phase-period">📅 \${ph.periode}</div>
      <ul class="proto-actions">
        \${ph.actions.slice(0,6).map(a => \`<li>\${a}</li>\`).join('')}
        \${ph.actions.length > 6 ? \`<li style="color:#94a3b8">+ \${ph.actions.length-6} autres actions...</li>\` : ''}
      </ul>
    </div>
  \`).join('')
}

// ═══════════════════════════════════════════════════════════════════════
// FILTRES
// ═══════════════════════════════════════════════════════════════════════
function applyFilters() {
  const typeVal = document.getElementById('filter-type').value
  const phaseVal = document.getElementById('filter-phase').value

  let filtered = allPoints.filter(p => {
    if (typeVal && p.type !== typeVal) return false
    if (!activeFilters.statut.includes(p.statut)) return false
    if (phaseVal && !p.phase_active?.includes(phaseVal)) return false
    return true
  })

  renderPoints(filtered)
}

function toggleStatus(btn, status) {
  btn.classList.toggle('active')
  if (activeFilters.statut.includes(status)) {
    activeFilters.statut = activeFilters.statut.filter(s => s !== status)
  } else {
    activeFilters.statut.push(status)
  }
  applyFilters()
}

function searchPoints() {
  const q = document.getElementById('search-input').value.toLowerCase()
  if (!q) { applyFilters(); return }
  const filtered = allPoints.filter(p =>
    p.nom.toLowerCase().includes(q) ||
    p.quartier.toLowerCase().includes(q) ||
    p.adresse.toLowerCase().includes(q)
  )
  renderPoints(filtered)
}

// ═══════════════════════════════════════════════════════════════════════
// COUCHES CARTOGRAPHIQUES
// ═══════════════════════════════════════════════════════════════════════
function toggleLayer(name) {
  const checkbox = document.getElementById(\`layer-\${name}\`)
  const lg = layerGroups[name]
  if (!lg) return
  if (checkbox.checked) {
    map.addLayer(lg)
  } else {
    map.removeLayer(lg)
  }
}

async function loadRestaurants() {
  const resp = await axios.get('/api/restaurants')
  allRestaurants = resp.data.data
  layerGroups.restaurants.clearLayers()
  allRestaurants.forEach(r => {
    createRestaurantMarker(r).addTo(layerGroups.restaurants)
  })
}

async function loadProjets() {
  const resp = await axios.get('/api/projets')
  allProjets = resp.data.data
  layerGroups.projets.clearLayers()
  allProjets.forEach(p => {
    createProjetMarker(p).addTo(layerGroups.projets)
  })
}

function addHeatmapCircles() {
  layerGroups.heatmap.clearLayers()
  allPoints.forEach(point => {
    const intensity = point.taux_remplissage / 100
    const color = intensity > 0.8 ? '#ef4444' : intensity > 0.5 ? '#f59e0b' : '#16a34a'
    L.circle([point.lat, point.lng], {
      radius: 200 + (point.capacite_m3 || 5) * 15,
      color: color, fillColor: color,
      fillOpacity: 0.15, opacity: 0.4, weight: 1
    }).addTo(layerGroups.heatmap)
  })
}

// ═══════════════════════════════════════════════════════════════════════
// CHARGEMENT DONNÉES + STATS
// ═══════════════════════════════════════════════════════════════════════
async function loadStats() {
  const resp = await axios.get('/api/stats')
  const s = resp.data.data
  document.getElementById('stat-total').textContent = s.total_points
  document.getElementById('stat-actifs').textContent = s.actifs
  document.getElementById('stat-capacite').textContent = s.capacite_totale_m3
  document.getElementById('stat-remplissage').textContent = s.remplissage_moyen_pct + '%'

  const pc = PHASE_CONFIG[s.phase_magal] || PHASE_CONFIG.normale
  const pi = document.getElementById('phase-indicator')
  const pn = document.getElementById('phase-name-label')
  const pd = document.getElementById('phase-desc-label')
  const pb = document.getElementById('phase-badge')

  pi.className = \`phase-indicator \${s.phase_magal}\`
  pn.textContent = pc.label
  pd.textContent = pc.desc
  pb.innerHTML = \`<i class="fas fa-calendar-alt"></i> \${pc.label}\`
  pb.style.borderColor = pc.color
  pb.style.color = pc.color
}

async function loadPoints() {
  const resp = await axios.get('/api/points-collecte')
  allPoints = resp.data.data
  renderPoints(allPoints)
  addHeatmapCircles()
}

async function init() {
  initMap()
  await Promise.all([loadStats(), loadPoints(), loadRestaurants(), loadProjets(), loadProtocole()])
}

// Démarrage
init().catch(console.error)

// Rafraîchissement automatique toutes les 5 minutes
setInterval(() => {
  loadStats()
  loadPoints()
}, 5 * 60 * 1000)
</script>
</body>
</html>`
}
