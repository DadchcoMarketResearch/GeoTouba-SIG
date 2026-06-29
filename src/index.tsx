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
  const quartiers = getQuartiers()
  const actifs = points.filter((p) => p.statut === 'actif').length
  const capaciteTotale = points.reduce((s, p) => s + (p.capacite_m3 || 0), 0)
  const pointsActifs = points.filter((p) => p.statut === 'actif')
  const remplissageMoyen = pointsActifs.length
    ? pointsActifs.reduce((s, p) => s + (p.taux_remplissage || 0), 0) / pointsActifs.length
    : 0

  // Stats par niveau de quartier
  const byNiveau = {
    historique: points.filter((p) => p.niveau_quartier === 'historique').length,
    village: points.filter((p) => p.niveau_quartier === 'village').length,
    peripherique: points.filter((p) => p.niveau_quartier === 'peripherique').length,
  }

  // Stats par type
  const byType: Record<string, number> = {}
  points.forEach((p) => {
    byType[p.type] = (byType[p.type] || 0) + 1
  })

  return c.json({
    success: true,
    data: {
      total_points: points.length,
      actifs,
      inactifs: points.filter((p) => p.statut === 'inactif').length,
      en_construction: points.filter((p) => p.statut === 'en_construction').length,
      capacite_totale_m3: Math.round(capaciteTotale * 10) / 10,
      remplissage_moyen_pct: Math.round(remplissageMoyen),
      points_critiques: points.filter((p) => p.taux_remplissage >= 80).length,
      total_quartiers: quartiers.length,
      quartiers_par_niveau: {
        historiques: quartiers.filter((q) => q.niveau === 'historique').length,
        villages: quartiers.filter((q) => q.niveau === 'village').length,
        peripheriques: quartiers.filter((q) => q.niveau === 'peripherique').length,
      },
      points_par_niveau: byNiveau,
      points_par_type: byType,
      derniere_maj: new Date().toISOString(),
      phase_magal: getPhaseMagal(),
    },
  })
})

// ─── API : Protocole Magal ───────────────────────────────────────────────────
app.get('/api/protocole-magal', (c) => {
  return c.json({ success: true, data: getProtocoleMagal() })
})

// ─── API : Quartiers ─────────────────────────────────────────────────────────
app.get('/api/quartiers', (c) => {
  const niveau = c.req.query('niveau')
  let data = getQuartiers()
  if (niveau) data = data.filter((q) => q.niveau === niveau)
  return c.json({ success: true, count: data.length, data })
})

// ─── API : Mise à jour terrain (agent mobile) ────────────────────────────────
app.post('/api/terrain/update', async (c) => {
  const body = await c.req.json()
  const { point_id, taux_remplissage, statut, notes_terrain, agent_nom, lat_agent, lng_agent } = body

  if (!point_id || taux_remplissage === undefined) {
    return c.json({ success: false, message: 'point_id et taux_remplissage requis' }, 400)
  }

  const alertes = []
  if (taux_remplissage >= 80) {
    alertes.push({
      type: 'critique',
      message: `ALERTE: Point #${point_id} à ${taux_remplissage}% — collecte urgente requise`,
      timestamp: new Date().toISOString(),
    })
  }

  return c.json({
    success: true,
    message: 'Mise à jour enregistrée',
    data: {
      point_id,
      taux_remplissage,
      statut: statut || 'actif',
      agent_nom: agent_nom || 'Anonyme',
      timestamp: new Date().toISOString(),
      alertes,
      notification_envoyee: taux_remplissage >= 80,
    },
  })
})

// ─── API : Signalement terrain ────────────────────────────────────────────────
app.post('/api/terrain/signalement', async (c) => {
  const body = await c.req.json()
  const { point_id, type_probleme, description, priorite, agent_nom } = body

  return c.json({
    success: true,
    message: 'Signalement enregistré',
    data: {
      id: Math.floor(Math.random() * 10000),
      point_id,
      type_probleme,
      description,
      priorite: priorite || 'normale',
      agent_nom: agent_nom || 'Anonyme',
      statut: 'ouvert',
      timestamp: new Date().toISOString(),
    },
  })
})

// ─── API : Alertes actives ────────────────────────────────────────────────────
app.get('/api/alertes', (c) => {
  const points = getPointsCollecte()
  const alertes = points
    .filter((p) => p.statut === 'actif' && p.taux_remplissage >= 80)
    .map((p) => ({
      id: p.id,
      nom: p.nom,
      quartier: p.quartier,
      taux_remplissage: p.taux_remplissage,
      niveau: p.taux_remplissage >= 95 ? 'critique' : 'warning',
      message: `Bac à ${p.taux_remplissage}% — intervention requise`,
      lat: p.lat,
      lng: p.lng,
      responsable: p.responsable,
      timestamp: new Date().toISOString(),
    }))
  return c.json({ success: true, count: alertes.length, data: alertes })
})

// ─── API : Export GeoJSON ─────────────────────────────────────────────────────
app.get('/api/export/geojson', (c) => {
  const points = getPointsCollecte()
  const restaurants = getRestaurants()
  const projets = getProjets()
  const layer = c.req.query('layer') || 'all'

  const makeFeature = (item: any, sourceType: string) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
    properties: { ...item, source_type: sourceType },
  })

  const quartiers = getQuartiers()
  let features: any[] = []
  if (layer === 'all' || layer === 'points') {
    features = features.concat(points.map((p) => makeFeature(p, 'point_collecte')))
  }
  if (layer === 'all' || layer === 'restaurants') {
    features = features.concat(restaurants.map((r) => makeFeature(r, 'restaurant')))
  }
  if (layer === 'all' || layer === 'projets') {
    features = features.concat(projets.map((p) => makeFeature(p, 'projet_valorisation')))
  }
  if (layer === 'all' || layer === 'quartiers') {
    features = features.concat(quartiers.map((q) => makeFeature(q, 'quartier')))
  }

  const geojson = {
    type: 'FeatureCollection',
    name: 'GeoTouba_Dechets_Organiques',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    metadata: {
      title: 'Points de collecte déchets organiques — Touba, Sénégal',
      description: 'Portail SIG GeoTouba — Export QGIS',
      generated_at: new Date().toISOString(),
      total_features: features.length,
      coordinate_system: 'WGS84 (EPSG:4326)',
      source: 'GeoTouba SIG Platform',
    },
    features,
  }

  c.header('Content-Type', 'application/geo+json')
  c.header('Content-Disposition', `attachment; filename="geotouba_${layer}_${new Date().toISOString().slice(0, 10)}.geojson"`)
  return c.json(geojson)
})

// ─── API : Export CSV ─────────────────────────────────────────────────────────
app.get('/api/export/csv', (c) => {
  const points = getPointsCollecte()
  const headers = ['id','nom','type','statut','lat','lng','adresse','quartier','niveau_quartier','capacite_m3','taux_remplissage','frequence_collecte','responsable','derniere_collecte','prochaine_collecte','coordonnees_gps','notes']
  const rows = points.map((p) =>
    headers.map((h) => {
      const val = (p as any)[h]
      return typeof val === 'string' && val.includes(',') ? `"${val}"` : val ?? ''
    }).join(',')
  )
  const csv = [headers.join(','), ...rows].join('\n')
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="geotouba_points_${new Date().toISOString().slice(0, 10)}.csv"`)
  return c.text('\uFEFF' + csv)
})

// ─── API : Notifications config ───────────────────────────────────────────────
app.post('/api/notifications/test', async (c) => {
  const body = await c.req.json()
  const { email, phone, channel } = body
  return c.json({
    success: true,
    message: `Test de notification envoyé via ${channel}`,
    data: { channel, destination: email || phone, timestamp: new Date().toISOString() },
  })
})

// ─── Pages de l'application ───────────────────────────────────────────────────
app.get('/', (c) => c.html(getMainHtml()))
app.get('/carte', (c) => c.html(getMainHtml()))
app.get('/agent', (c) => c.html(getAgentPwaHtml()))
app.get('/export', (c) => c.html(getExportHtml()))
app.get('/alertes', (c) => c.html(getAlertesHtml()))
app.get('/certificat', (c) => c.html(getCertificatHtml()))

// ─── API : Génération certificat de traçabilité ───────────────────────────────
app.post('/api/certificat/generer', async (c) => {
  const body = await c.req.json()
  const {
    type_dechet, quantite_kg, unite = 'kg',
    point_collecte_id, point_collecte_nom,
    quartier, operateur, destination,
    date_collecte, notes_agent,
  } = body

  if (!type_dechet || !quantite_kg) {
    return c.json({ success: false, message: 'type_dechet et quantite_kg requis' }, 400)
  }

  // ── Facteurs CO2 évité par type de déchet (kgCO2eq / tonne)
  // Sources : ADEME, GIZ Sénégal, IPCC AR6
  const CO2_FACTORS: Record<string, { facteur: number; label: string; methode: string }> = {
    dechets_alimentaires:   { facteur: 600,  label: 'Déchets alimentaires',         methode: 'Compostage vs enfouissement (CH₄ évité)' },
    residus_vegetaux:       { facteur: 450,  label: 'Résidus végétaux / verts',     methode: 'Compostage vs incinération à ciel ouvert' },
    fumier_animal:          { facteur: 800,  label: 'Fumier / lisier animal',        methode: 'Biogaz (CH₄ capté) vs dégradation libre' },
    huiles_graisses:        { facteur: 900,  label: 'Huiles et graisses alimentaires', methode: 'Biogaz vs décharge (ADEME 2023)' },
    residus_marche:         { facteur: 520,  label: 'Résidus de marché',             methode: 'Compostage vs décharge ouverte' },
    boues_organiques:       { facteur: 700,  label: 'Boues organiques',              methode: 'Valorisation vs lixiviat' },
    dechets_dahira:         { facteur: 580,  label: 'Déchets daharas / communautaires', methode: 'Compostage collectif vs brûlage' },
    organique_mixte:        { facteur: 550,  label: 'Organique mixte',               methode: 'Valorisation partielle moyenne ADEME' },
    dechets_verts:          { facteur: 480,  label: 'Déchets verts / jardins',       methode: 'Compostage vs incinération' },
    dechets_maraichage:     { facteur: 430,  label: 'Résidus maraîchage',            methode: 'Retour sol vs décharge' },
  }

  const config = CO2_FACTORS[type_dechet] || CO2_FACTORS.organique_mixte
  const quantite_tonnes = quantite_kg / 1000
  const co2_evite_kg    = Math.round(config.facteur * quantite_tonnes * 100) / 100
  const arbres_equiv    = Math.round(co2_evite_kg / 21.77 * 10) / 10  // 1 arbre absorbe ~21.77 kgCO2/an
  const km_voiture_equiv= Math.round(co2_evite_kg / 0.21)             // 210 gCO2/km voiture moyenne

  // Numéro de certificat unique
  const now = new Date()
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '')
  const randPart = Math.random().toString(36).substring(2, 7).toUpperCase()
  const numero = `GTO-${datePart}-${randPart}`

  const certificat = {
    numero,
    date_emission: now.toISOString(),
    date_collecte: date_collecte || now.toISOString().slice(0, 10),
    statut: 'valide',
    // Déchet
    type_dechet,
    type_dechet_label: config.label,
    quantite_kg,
    unite,
    // Impact environnemental
    co2_evite_kg,
    co2_evite_tonnes: Math.round(co2_evite_kg / 10) / 100,
    methode_calcul: config.methode,
    facteur_emission: config.facteur,
    equivalences: {
      arbres_1_an: arbres_equiv,
      km_voiture: km_voiture_equiv,
      foyers_electricite_jours: Math.round(co2_evite_kg / 1.5),
    },
    // Localisation
    point_collecte_id: point_collecte_id || null,
    point_collecte_nom: point_collecte_nom || 'Point non spécifié',
    quartier: quartier || 'Touba',
    ville: 'Touba, Sénégal',
    // Responsabilité
    operateur: operateur || 'Opérateur GeoTouba',
    destination: destination || 'Valorisation organique',
    notes_agent: notes_agent || '',
    // Conformité
    norme: 'ADEME France / GIZ Sénégal / IPCC AR6',
    verificateur: 'Système GeoTouba SIG v2.0',
    hash: btoa(`${numero}:${type_dechet}:${quantite_kg}:${co2_evite_kg}`).slice(0, 16),
  }

  return c.json({ success: true, data: certificat })
})

// ─── API : Vérification certificat ───────────────────────────────────────────
app.get('/api/certificat/verifier/:numero', (c) => {
  const numero = c.req.param('numero')
  // En production : lookup en base. Ici simulation.
  const valide = numero.startsWith('GTO-')
  return c.json({
    success: true,
    data: {
      numero,
      statut: valide ? 'valide' : 'invalide',
      message: valide
        ? 'Certificat authentifié — émis par GeoTouba SIG'
        : 'Numéro de certificat non reconnu',
      verificateur: 'GeoTouba SIG Platform',
      date_verification: new Date().toISOString(),
    },
  })
})

// ─── API : Facteurs CO2 ───────────────────────────────────────────────────────
app.get('/api/certificat/facteurs-co2', (c) => {
  return c.json({
    success: true,
    source: 'ADEME 2023, GIZ Sénégal, IPCC AR6',
    unite: 'kgCO2eq évité par tonne de déchet valorisé',
    data: [
      { type: 'dechets_alimentaires',  label: 'Déchets alimentaires',          facteur: 600, methode: 'Compostage vs enfouissement' },
      { type: 'residus_vegetaux',      label: 'Résidus végétaux / verts',      facteur: 450, methode: 'Compostage vs incinération' },
      { type: 'fumier_animal',         label: 'Fumier / lisier animal',         facteur: 800, methode: 'Biogaz vs dégradation libre' },
      { type: 'huiles_graisses',       label: 'Huiles et graisses',            facteur: 900, methode: 'Biogaz vs décharge (ADEME 2023)' },
      { type: 'residus_marche',        label: 'Résidus de marché',             facteur: 520, methode: 'Compostage vs décharge ouverte' },
      { type: 'boues_organiques',      label: 'Boues organiques',              facteur: 700, methode: 'Valorisation vs lixiviat' },
      { type: 'dechets_dahira',        label: 'Déchets daharas / communautaires', facteur: 580, methode: 'Compostage vs brûlage' },
      { type: 'organique_mixte',       label: 'Organique mixte',               facteur: 550, methode: 'Valorisation partielle (moyenne)' },
      { type: 'dechets_verts',         label: 'Déchets verts / jardins',       facteur: 480, methode: 'Compostage vs incinération' },
      { type: 'dechets_maraichage',    label: 'Résidus maraîchage',            facteur: 430, methode: 'Retour sol vs décharge' },
    ],
  })
})
app.get('/manifest.json', (c) => {
  c.header('Content-Type', 'application/manifest+json')
  return c.json(getPwaManifest())
})
app.get('/sw.js', (c) => {
  c.header('Content-Type', 'application/javascript')
  c.header('Service-Worker-Allowed', '/')
  return c.text(getServiceWorkerJs())
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

// ─── Données quartiers ────────────────────────────────────────────────────────
function getQuartiers() {
  return [
    // ── Niveau 1 : 13 quartiers historiques et administratifs ──
    { id: 'q01', nom: 'Darou Khoudoss',    niveau: 'historique', lat: 14.8730, lng: -15.8810, population_est: 45000, superficie_km2: 2.1 },
    { id: 'q02', nom: 'Gouye Mbind',       niveau: 'historique', lat: 14.8620, lng: -15.8840, population_est: 28000, superficie_km2: 1.5 },
    { id: 'q03', nom: 'Darou Miname',      niveau: 'historique', lat: 14.8790, lng: -15.8760, population_est: 32000, superficie_km2: 1.8 },
    { id: 'q04', nom: 'Touba Guédé',       niveau: 'historique', lat: 14.8580, lng: -15.8650, population_est: 25000, superficie_km2: 1.6 },
    { id: 'q05', nom: 'Touba Mosquée',     niveau: 'historique', lat: 14.8695, lng: -15.8820, population_est: 60000, superficie_km2: 1.2 },
    { id: 'q06', nom: 'Keur Niang',        niveau: 'historique', lat: 14.8570, lng: -15.8920, population_est: 22000, superficie_km2: 2.5 },
    { id: 'q07', nom: 'Khaira',            niveau: 'historique', lat: 14.8840, lng: -15.8740, population_est: 18000, superficie_km2: 1.4 },
    { id: 'q08', nom: 'Guédé Bousso',      niveau: 'historique', lat: 14.8760, lng: -15.8680, population_est: 20000, superficie_km2: 1.7 },
    { id: 'q09', nom: 'Samer',             niveau: 'historique', lat: 14.8640, lng: -15.8720, population_est: 30000, superficie_km2: 1.9 },
    { id: 'q10', nom: 'Darou Marnane',     niveau: 'historique', lat: 14.8780, lng: -15.8700, population_est: 35000, superficie_km2: 2.0 },
    { id: 'q11', nom: 'Ndame',             niveau: 'historique', lat: 14.8710, lng: -15.8640, population_est: 16000, superficie_km2: 1.3 },
    { id: 'q12', nom: 'Madiyana',          niveau: 'historique', lat: 14.8650, lng: -15.8600, population_est: 24000, superficie_km2: 2.2 },
    { id: 'q13', nom: 'Dianatoul Mahwa',   niveau: 'historique', lat: 14.8600, lng: -15.8780, population_est: 19000, superficie_km2: 1.6 },
    // ── Niveau 2 : 25 villages en zone urbaine ──
    { id: 'v01', nom: 'Alia',                     niveau: 'village', lat: 14.8820, lng: -15.8860, population_est: 8000,  superficie_km2: 0.8 },
    { id: 'v02', nom: 'Arifina',                  niveau: 'village', lat: 14.8750, lng: -15.8900, population_est: 9500,  superficie_km2: 0.9 },
    { id: 'v03', nom: 'Boukhatoul Moubarak',       niveau: 'village', lat: 14.8680, lng: -15.8950, population_est: 11000, superficie_km2: 1.1 },
    { id: 'v04', nom: 'Boustanoul',               niveau: 'village', lat: 14.8720, lng: -15.8760, population_est: 7500,  superficie_km2: 0.7 },
    { id: 'v05', nom: 'Darou Alimoul Khabir',      niveau: 'village', lat: 14.8800, lng: -15.8800, population_est: 12000, superficie_km2: 1.0 },
    { id: 'v06', nom: 'Darou Khadim',             niveau: 'village', lat: 14.8660, lng: -15.8840, population_est: 14000, superficie_km2: 1.2 },
    { id: 'v07', nom: 'Darou Marnane 2',           niveau: 'village', lat: 14.8800, lng: -15.8680, population_est: 10000, superficie_km2: 1.0 },
    { id: 'v08', nom: 'Darou Salam Ndame',         niveau: 'village', lat: 14.8690, lng: -15.8620, population_est: 9000,  superficie_km2: 0.9 },
    { id: 'v09', nom: 'Ndindy Abdou',             niveau: 'village', lat: 14.8740, lng: -15.8580, population_est: 7000,  superficie_km2: 0.8 },
    { id: 'v10', nom: 'Ndamatou 1',               niveau: 'village', lat: 14.8680, lng: -15.8680, population_est: 18000, superficie_km2: 1.5 },
    { id: 'v11', nom: 'Route de Darou Mousty',     niveau: 'village', lat: 14.8550, lng: -15.8550, population_est: 13000, superficie_km2: 2.0 },
    { id: 'v12', nom: 'Same Lah',                 niveau: 'village', lat: 14.8640, lng: -15.8730, population_est: 11000, superficie_km2: 1.0 },
    { id: 'v13', nom: 'Touba Al Azhar',           niveau: 'village', lat: 14.8590, lng: -15.8700, population_est: 15000, superficie_km2: 1.3 },
    { id: 'v14', nom: 'Touba HLM',               niveau: 'village', lat: 14.8760, lng: -15.8550, population_est: 22000, superficie_km2: 1.8 },
    // ── Niveau 3 : Quartiers périphériques ──
    { id: 'p01', nom: 'Mbacké Bâri',   niveau: 'peripherique', lat: 14.8510, lng: -15.8400, population_est: 8000,  superficie_km2: 3.0 },
    { id: 'p02', nom: 'Touba Wadane',  niveau: 'peripherique', lat: 14.8900, lng: -15.8700, population_est: 12000, superficie_km2: 2.5 },
    { id: 'p03', nom: 'Diakhaye',      niveau: 'peripherique', lat: 14.8480, lng: -15.8600, population_est: 6000,  superficie_km2: 2.0 },
    { id: 'p04', nom: 'NDindy',        niveau: 'peripherique', lat: 14.8830, lng: -15.8580, population_est: 7500,  superficie_km2: 1.5 },
    { id: 'p05', nom: 'Taif',          niveau: 'peripherique', lat: 14.8460, lng: -15.8750, population_est: 9000,  superficie_km2: 2.2 },
    { id: 'p06', nom: 'Bélel',         niveau: 'peripherique', lat: 14.8540, lng: -15.8480, population_est: 5000,  superficie_km2: 1.8 },
    { id: 'p07', nom: 'Sourah',        niveau: 'peripherique', lat: 14.8920, lng: -15.8600, population_est: 6500,  superficie_km2: 1.7 },
    { id: 'p08', nom: 'Mbal',          niveau: 'peripherique', lat: 14.8430, lng: -15.8900, population_est: 5500,  superficie_km2: 2.0 },
    { id: 'p09', nom: 'Touba Ndiarème',niveau: 'peripherique', lat: 14.8880, lng: -15.8550, population_est: 8000,  superficie_km2: 1.6 },
    { id: 'p10', nom: 'Loyène',        niveau: 'peripherique', lat: 14.8480, lng: -15.8980, population_est: 4500,  superficie_km2: 2.5 },
    { id: 'p11', nom: 'Kenya',         niveau: 'peripherique', lat: 14.8950, lng: -15.8750, population_est: 7000,  superficie_km2: 1.9 },
    { id: 'p12', nom: 'Djibock',       niveau: 'peripherique', lat: 14.8400, lng: -15.8700, population_est: 5000,  superficie_km2: 2.8 },
    { id: 'p13', nom: 'Lyndiane',      niveau: 'peripherique', lat: 14.8560, lng: -15.9050, population_est: 6000,  superficie_km2: 2.1 },
    { id: 'p14', nom: 'Diabir',        niveau: 'peripherique', lat: 14.8950, lng: -15.8450, population_est: 5500,  superficie_km2: 1.8 },
    { id: 'p15', nom: 'Touba Bagdad',  niveau: 'peripherique', lat: 14.8610, lng: -15.8570, population_est: 10000, superficie_km2: 1.5 },
  ]
}

function getPointsCollecte() {
  return [
    // ══════════════════════════════════════════════════════════════
    // ZONE CENTRALE — Touba Mosquée / Darou Khoudoss (priorité max)
    // ══════════════════════════════════════════════════════════════
    {
      id: 1,
      nom: 'Bac Central Grande Mosquée',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8696,
      lng: -15.8814,
      adresse: 'Esplanade Nord Grande Mosquée',
      quartier: 'Touba Mosquée',
      niveau_quartier: 'historique',
      capacite_m3: 15,
      taux_remplissage: 68,
      frequence_collecte: '3x/jour (Magal) / Quotidienne (normale)',
      responsable: 'Dahira Matlaboul Fawzaïni',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 08:00',
      prochaine_collecte: '2026-06-24 20:00',
      types_dechets: ['Déchets alimentaires', 'Restes de repas communautaires'],
      coordonnees_gps: '14.8696°N, 15.8814°W',
      notes: 'Zone à très haute densité lors du Magal. Renforcement x3 prévu.',
    },
    {
      id: 2,
      nom: 'Bac Esplanade Sud Mosquée',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8680,
      lng: -15.8820,
      adresse: 'Esplanade Sud Grande Mosquée',
      quartier: 'Touba Mosquée',
      niveau_quartier: 'historique',
      capacite_m3: 12,
      taux_remplissage: 74,
      frequence_collecte: '2x/jour',
      responsable: 'Dahira Matlaboul Fawzaïni',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 07:00',
      prochaine_collecte: '2026-06-24 19:00',
      types_dechets: ['Déchets daharas', 'Résidus de cuisine communautaire'],
      coordonnees_gps: '14.8680°N, 15.8820°W',
      notes: 'Flux organique très important lors des zawiyahs et cérémonies.',
    },
    {
      id: 3,
      nom: 'Centre Tri Principal Darou Khoudoss',
      type: 'centre_tri',
      statut: 'actif',
      lat: 14.8740,
      lng: -15.8790,
      adresse: 'Route de Mbacké, Darou Khoudoss',
      quartier: 'Darou Khoudoss',
      niveau_quartier: 'historique',
      capacite_m3: 80,
      taux_remplissage: 50,
      frequence_collecte: 'Quotidienne',
      responsable: 'Mairie de Touba + Partenaire privé',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 04:00',
      prochaine_collecte: '2026-06-25 04:00',
      types_dechets: ['Tous types après tri', 'Fraction organique séparée'],
      coordonnees_gps: '14.8740°N, 15.8790°W',
      notes: 'Centre principal de tri. Capacité : 30 tonnes/jour.',
    },
    {
      id: 4,
      nom: 'Bac Darou Khoudoss Nord',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8720,
      lng: -15.8800,
      adresse: 'Rue des Daharas, Darou Khoudoss',
      quartier: 'Darou Khoudoss',
      niveau_quartier: 'historique',
      capacite_m3: 8,
      taux_remplissage: 58,
      frequence_collecte: 'Quotidienne',
      responsable: 'CADAK-CAR',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 06:00',
      prochaine_collecte: '2026-06-25 06:00',
      types_dechets: ['Déchets ménagers', 'Résidus daharas'],
      coordonnees_gps: '14.8720°N, 15.8800°W',
      notes: 'Secteur dense avec nombreuses daharas.',
    },
    // ══════════════════════════════════════════════════════════════
    // CENTRE COMMERCIAL — Marché / Gare Routière
    // ══════════════════════════════════════════════════════════════
    {
      id: 5,
      nom: 'Bac Central Marché Ocas',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8658,
      lng: -15.8780,
      adresse: 'Marché Ocas, entrée principale',
      quartier: 'Samer',
      niveau_quartier: 'historique',
      capacite_m3: 10,
      taux_remplissage: 72,
      frequence_collecte: 'Quotidienne',
      responsable: 'Mairie de Touba',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 06:30',
      prochaine_collecte: '2026-06-25 06:30',
      types_dechets: ['Déchets alimentaires', 'Résidus végétaux', 'Déchets de marché'],
      coordonnees_gps: '14.8658°N, 15.8780°W',
      notes: 'Point stratégique. Saturation fréquente lors du Magal.',
    },
    {
      id: 6,
      nom: 'Bac Gare Routière',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8720,
      lng: -15.8750,
      adresse: 'Gare Routière de Touba',
      quartier: 'Samer',
      niveau_quartier: 'historique',
      capacite_m3: 10,
      taux_remplissage: 91,
      frequence_collecte: '2x/jour',
      responsable: 'CETOM',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 10:00',
      prochaine_collecte: '2026-06-24 22:00',
      types_dechets: ['Déchets de voyage', 'Restes alimentaires'],
      coordonnees_gps: '14.8720°N, 15.8750°W',
      notes: 'CRITIQUE : Saturation quasi-permanente. Passage urgent requis.',
    },
    {
      id: 7,
      nom: 'PAV Marché Samer',
      type: 'point_apport_volontaire',
      statut: 'actif',
      lat: 14.8645,
      lng: -15.8760,
      adresse: 'Derrière marché Samer',
      quartier: 'Samer',
      niveau_quartier: 'historique',
      capacite_m3: 6,
      taux_remplissage: 55,
      frequence_collecte: 'Quotidienne',
      responsable: 'GIE Collecte Samer',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-24 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Déchets marchands organiques', 'Résidus végétaux'],
      coordonnees_gps: '14.8645°N, 15.8760°W',
      notes: 'Géré par GIE local. Bonne organisation de tri.',
    },
    // ══════════════════════════════════════════════════════════════
    // GOUYE MBIND
    // ══════════════════════════════════════════════════════════════
    {
      id: 8,
      nom: 'Bac Principal Gouye Mbind',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8620,
      lng: -15.8840,
      adresse: 'Rue principale, Gouye Mbind',
      quartier: 'Gouye Mbind',
      niveau_quartier: 'historique',
      capacite_m3: 8,
      taux_remplissage: 83,
      frequence_collecte: 'Quotidienne',
      responsable: 'CADAK-CAR',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 05:00',
      prochaine_collecte: '2026-06-25 05:00',
      types_dechets: ['Ordures ménagères', 'Déchets organiques', 'Résidus animaux'],
      coordonnees_gps: '14.8620°N, 15.8840°W',
      notes: 'Taux élevé — passage supplémentaire nécessaire.',
    },
    {
      id: 9,
      nom: 'PAV Gouye Mbind Est',
      type: 'point_apport_volontaire',
      statut: 'actif',
      lat: 14.8610,
      lng: -15.8820,
      adresse: 'Carrefour Est, Gouye Mbind',
      quartier: 'Gouye Mbind',
      niveau_quartier: 'historique',
      capacite_m3: 4,
      taux_remplissage: 60,
      frequence_collecte: '3x/semaine',
      responsable: 'Comité de Quartier Gouye Mbind',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-23 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Déchets ménagers organiques'],
      coordonnees_gps: '14.8610°N, 15.8820°W',
      notes: 'Initiative communautaire.',
    },
    // ══════════════════════════════════════════════════════════════
    // DAROU MARNANE
    // ══════════════════════════════════════════════════════════════
    {
      id: 10,
      nom: 'Bac Darou Marnane Centre',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8780,
      lng: -15.8700,
      adresse: 'Avenue centrale, Darou Marnane',
      quartier: 'Darou Marnane',
      niveau_quartier: 'historique',
      capacite_m3: 6,
      taux_remplissage: 48,
      frequence_collecte: 'Quotidienne',
      responsable: 'Mairie de Touba',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 06:00',
      prochaine_collecte: '2026-06-25 06:00',
      types_dechets: ['Déchets ménagers', 'Résidus de cuisine'],
      coordonnees_gps: '14.8780°N, 15.8700°W',
      notes: 'Quartier historique bien organisé.',
    },
    {
      id: 11,
      nom: 'PAV Darou Marnane Mosquée',
      type: 'point_apport_volontaire',
      statut: 'actif',
      lat: 14.8765,
      lng: -15.8715,
      adresse: 'Mosquée de quartier, Darou Marnane',
      quartier: 'Darou Marnane',
      niveau_quartier: 'historique',
      capacite_m3: 3,
      taux_remplissage: 35,
      frequence_collecte: '3x/semaine',
      responsable: 'Dahira Darou Marnane',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-23 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Déchets religieux', 'Résidus cuisine collective'],
      coordonnees_gps: '14.8765°N, 15.8715°W',
      notes: 'Géré par les fidèles. Tri à la source pratiqué.',
    },
    {
      id: 12,
      nom: 'Bac Darou Marnane 2',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8800,
      lng: -15.8680,
      adresse: 'Extension Darou Marnane 2',
      quartier: 'Darou Marnane',
      niveau_quartier: 'historique',
      capacite_m3: 5,
      taux_remplissage: 42,
      frequence_collecte: '3x/semaine',
      responsable: 'Comité de quartier',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-23 07:30',
      prochaine_collecte: '2026-06-25 07:30',
      types_dechets: ['Déchets ménagers'],
      coordonnees_gps: '14.8800°N, 15.8680°W',
      notes: 'Nouveau secteur résidentiel.',
    },
    // ══════════════════════════════════════════════════════════════
    // DAROU MINAME
    // ══════════════════════════════════════════════════════════════
    {
      id: 13,
      nom: 'Bac Darou Miname Centre',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8790,
      lng: -15.8760,
      adresse: 'Carrefour central, Darou Miname',
      quartier: 'Darou Miname',
      niveau_quartier: 'historique',
      capacite_m3: 7,
      taux_remplissage: 62,
      frequence_collecte: 'Quotidienne',
      responsable: 'Mairie de Touba',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 06:30',
      prochaine_collecte: '2026-06-25 06:30',
      types_dechets: ['Ordures ménagères', 'Déchets de cuisine'],
      coordonnees_gps: '14.8790°N, 15.8760°W',
      notes: 'Secteur résidentiel dense.',
    },
    {
      id: 14,
      nom: 'PAV Darou Miname École',
      type: 'point_apport_volontaire',
      statut: 'actif',
      lat: 14.8805,
      lng: -15.8745,
      adresse: 'École élémentaire Darou Miname',
      quartier: 'Darou Miname',
      niveau_quartier: 'historique',
      capacite_m3: 2,
      taux_remplissage: 28,
      frequence_collecte: '2x/semaine',
      responsable: 'APE Darou Miname',
      phase_active: ['normale'],
      derniere_collecte: '2026-06-23 08:00',
      prochaine_collecte: '2026-06-26 08:00',
      types_dechets: ['Déchets scolaires organiques'],
      coordonnees_gps: '14.8805°N, 15.8745°W',
      notes: 'Initiative des parents. Sensibilisation des enfants.',
    },
    // ══════════════════════════════════════════════════════════════
    // KHAIRA / GUÉDÉ BOUSSO
    // ══════════════════════════════════════════════════════════════
    {
      id: 15,
      nom: 'Bac Khaira Principal',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8840,
      lng: -15.8740,
      adresse: 'Rue centrale, Khaira',
      quartier: 'Khaira',
      niveau_quartier: 'historique',
      capacite_m3: 6,
      taux_remplissage: 55,
      frequence_collecte: 'Quotidienne',
      responsable: 'CADAK-CAR',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-24 06:00',
      prochaine_collecte: '2026-06-25 06:00',
      types_dechets: ['Ordures ménagères', 'Résidus organiques'],
      coordonnees_gps: '14.8840°N, 15.8740°W',
      notes: 'Quartier en expansion.',
    },
    {
      id: 16,
      nom: 'Bac Guédé Bousso Centre',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8760,
      lng: -15.8680,
      adresse: 'Avenue principale, Guédé Bousso',
      quartier: 'Guédé Bousso',
      niveau_quartier: 'historique',
      capacite_m3: 6,
      taux_remplissage: 49,
      frequence_collecte: '3x/semaine',
      responsable: 'Comité de quartier',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-23 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Déchets ménagers organiques'],
      coordonnees_gps: '14.8760°N, 15.8680°W',
      notes: 'Bonne gestion communautaire.',
    },
    // ══════════════════════════════════════════════════════════════
    // TOUBA GUÉDÉ / NDAME / MADIYANA / DIANATOUL MAHWA
    // ══════════════════════════════════════════════════════════════
    {
      id: 17,
      nom: 'Bac Touba Guédé',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8580,
      lng: -15.8650,
      adresse: 'Rue principale, Touba Guédé',
      quartier: 'Touba Guédé',
      niveau_quartier: 'historique',
      capacite_m3: 5,
      taux_remplissage: 44,
      frequence_collecte: '3x/semaine',
      responsable: 'Mairie de Touba',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-23 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Ordures ménagères'],
      coordonnees_gps: '14.8580°N, 15.8650°W',
      notes: 'Zone péricentrale à renforcer.',
    },
    {
      id: 18,
      nom: 'Bac Ndame Résidentiel',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8710,
      lng: -15.8640,
      adresse: 'Zone résidentielle Ndame',
      quartier: 'Ndame',
      niveau_quartier: 'historique',
      capacite_m3: 4,
      taux_remplissage: 38,
      frequence_collecte: '3x/semaine',
      responsable: 'GIE Ndame',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-23 07:30',
      prochaine_collecte: '2026-06-25 07:30',
      types_dechets: ['Déchets ménagers'],
      coordonnees_gps: '14.8710°N, 15.8640°W',
      notes: 'Quartier calme bien entretenu.',
    },
    {
      id: 19,
      nom: 'Bac Madiyana Centre',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8650,
      lng: -15.8600,
      adresse: 'Avenue Madiyana',
      quartier: 'Madiyana',
      niveau_quartier: 'historique',
      capacite_m3: 6,
      taux_remplissage: 52,
      frequence_collecte: 'Quotidienne',
      responsable: 'CADAK-CAR',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Ordures ménagères', 'Résidus de cuisine'],
      coordonnees_gps: '14.8650°N, 15.8600°W',
      notes: 'Zone en développement.',
    },
    {
      id: 20,
      nom: 'Bac Dianatoul Mahwa',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8600,
      lng: -15.8780,
      adresse: 'Rue centrale, Dianatoul Mahwa',
      quartier: 'Dianatoul Mahwa',
      niveau_quartier: 'historique',
      capacite_m3: 5,
      taux_remplissage: 47,
      frequence_collecte: '3x/semaine',
      responsable: 'Dahira Dianatoul Mahwa',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-23 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Déchets ménagers', 'Résidus daharas'],
      coordonnees_gps: '14.8600°N, 15.8780°W',
      notes: 'Implication forte de la dahira locale.',
    },
    // ══════════════════════════════════════════════════════════════
    // KEUR NIANG — Sites de valorisation
    // ══════════════════════════════════════════════════════════════
    {
      id: 21,
      nom: 'Plateforme Compostage Keur Niang',
      type: 'plateforme_compostage',
      statut: 'actif',
      lat: 14.8570,
      lng: -15.8920,
      adresse: 'Zone périphérique, Keur Niang',
      quartier: 'Keur Niang',
      niveau_quartier: 'historique',
      capacite_m3: 120,
      taux_remplissage: 35,
      frequence_collecte: 'Hebdomadaire',
      responsable: 'Projet WACA / ONG Green Touba',
      phase_active: ['normale', 'post-magal'],
      derniere_collecte: '2026-06-21 08:00',
      prochaine_collecte: '2026-06-28 08:00',
      types_dechets: ['Déchets verts', 'Matières organiques', 'Fumier animal'],
      coordonnees_gps: '14.8570°N, 15.8920°W',
      notes: 'Production ~2 tonnes de compost/semaine. Vente aux maraîchers.',
    },
    {
      id: 22,
      nom: 'Bac Keur Niang Village',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8560,
      lng: -15.8905,
      adresse: 'Centre village Keur Niang',
      quartier: 'Keur Niang',
      niveau_quartier: 'historique',
      capacite_m3: 5,
      taux_remplissage: 40,
      frequence_collecte: '3x/semaine',
      responsable: 'Comité de village',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-23 08:00',
      prochaine_collecte: '2026-06-25 08:00',
      types_dechets: ['Déchets ménagers', 'Résidus maraîchage'],
      coordonnees_gps: '14.8560°N, 15.8905°W',
      notes: 'Lié à la plateforme compostage voisine.',
    },
    // ══════════════════════════════════════════════════════════════
    // VILLAGES EN ZONE URBAINE
    // ══════════════════════════════════════════════════════════════
    {
      id: 23,
      nom: 'Bac Darou Khadim',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8660,
      lng: -15.8840,
      adresse: 'Rue principale, Darou Khadim',
      quartier: 'Darou Khadim',
      niveau_quartier: 'village',
      capacite_m3: 6,
      taux_remplissage: 65,
      frequence_collecte: 'Quotidienne',
      responsable: 'CADAK-CAR',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Ordures ménagères', 'Résidus cuisines dahiras'],
      coordonnees_gps: '14.8660°N, 15.8840°W',
      notes: 'Village dense proche du centre.',
    },
    {
      id: 24,
      nom: 'Bac Boukhatoul Moubarak',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8680,
      lng: -15.8950,
      adresse: 'Avenue Boukhatoul Moubarak',
      quartier: 'Boukhatoul Moubarak',
      niveau_quartier: 'village',
      capacite_m3: 8,
      taux_remplissage: 71,
      frequence_collecte: 'Quotidienne',
      responsable: 'Mairie de Touba',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 06:30',
      prochaine_collecte: '2026-06-25 06:30',
      types_dechets: ['Déchets ménagers', 'Résidus organiques'],
      coordonnees_gps: '14.8680°N, 15.8950°W',
      notes: 'Village à l\'ouest, flux en hausse.',
    },
    {
      id: 25,
      nom: 'PAV Darou Alimoul Khabir',
      type: 'point_apport_volontaire',
      statut: 'actif',
      lat: 14.8800,
      lng: -15.8800,
      adresse: 'Place centrale, Darou Alimoul Khabir',
      quartier: 'Darou Alimoul Khabir',
      niveau_quartier: 'village',
      capacite_m3: 4,
      taux_remplissage: 45,
      frequence_collecte: '3x/semaine',
      responsable: 'Comité dahira locale',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-23 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Résidus ménagers organiques'],
      coordonnees_gps: '14.8800°N, 15.8800°W',
      notes: 'Village organisé, comité actif.',
    },
    {
      id: 26,
      nom: 'Bac Alia',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8820,
      lng: -15.8860,
      adresse: 'Centre village Alia',
      quartier: 'Alia',
      niveau_quartier: 'village',
      capacite_m3: 4,
      taux_remplissage: 38,
      frequence_collecte: '3x/semaine',
      responsable: 'Comité de village',
      phase_active: ['normale', 'pre-magal'],
      derniere_collecte: '2026-06-23 08:00',
      prochaine_collecte: '2026-06-25 08:00',
      types_dechets: ['Ordures ménagères'],
      coordonnees_gps: '14.8820°N, 15.8860°W',
      notes: 'Village périphérique nord.',
    },
    {
      id: 27,
      nom: 'PAV Arifina',
      type: 'point_apport_volontaire',
      statut: 'actif',
      lat: 14.8750,
      lng: -15.8900,
      adresse: 'Arifina, rue centrale',
      quartier: 'Arifina',
      niveau_quartier: 'village',
      capacite_m3: 3,
      taux_remplissage: 42,
      frequence_collecte: '2x/semaine',
      responsable: 'GIE Arifina',
      phase_active: ['normale', 'pre-magal'],
      derniere_collecte: '2026-06-23 08:00',
      prochaine_collecte: '2026-06-26 08:00',
      types_dechets: ['Déchets ménagers organiques'],
      coordonnees_gps: '14.8750°N, 15.8900°W',
      notes: 'GIE féminin actif.',
    },
    {
      id: 28,
      nom: 'Bac Ndamatou 1',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8680,
      lng: -15.8680,
      adresse: 'Ndamatou 1, avenue principale',
      quartier: 'Ndamatou 1',
      niveau_quartier: 'village',
      capacite_m3: 8,
      taux_remplissage: 61,
      frequence_collecte: 'Quotidienne',
      responsable: 'Mairie de Touba',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Ordures ménagères', 'Résidus de cuisine'],
      coordonnees_gps: '14.8680°N, 15.8680°W',
      notes: 'Village dynamique, collecte régulière.',
    },
    {
      id: 29,
      nom: 'Bac Same Lah',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8640,
      lng: -15.8730,
      adresse: 'Same Lah, carrefour central',
      quartier: 'Same Lah',
      niveau_quartier: 'village',
      capacite_m3: 5,
      taux_remplissage: 56,
      frequence_collecte: 'Quotidienne',
      responsable: 'CADAK-CAR',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-24 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Ordures ménagères'],
      coordonnees_gps: '14.8640°N, 15.8730°W',
      notes: 'Zone commerçante locale.',
    },
    {
      id: 30,
      nom: 'Bac Touba Al Azhar',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8590,
      lng: -15.8700,
      adresse: 'Avenue Touba Al Azhar',
      quartier: 'Touba Al Azhar',
      niveau_quartier: 'village',
      capacite_m3: 6,
      taux_remplissage: 53,
      frequence_collecte: 'Quotidienne',
      responsable: 'Mairie de Touba',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-24 06:30',
      prochaine_collecte: '2026-06-25 06:30',
      types_dechets: ['Ordures ménagères', 'Déchets organiques'],
      coordonnees_gps: '14.8590°N, 15.8700°W',
      notes: 'Quartier résidentiel structuré.',
    },
    {
      id: 31,
      nom: 'PAV Touba HLM',
      type: 'point_apport_volontaire',
      statut: 'actif',
      lat: 14.8760,
      lng: -15.8550,
      adresse: 'Touba HLM, allée centrale',
      quartier: 'Touba HLM',
      niveau_quartier: 'village',
      capacite_m3: 5,
      taux_remplissage: 44,
      frequence_collecte: '3x/semaine',
      responsable: 'Syndicat résidents HLM',
      phase_active: ['normale', 'pre-magal'],
      derniere_collecte: '2026-06-23 08:00',
      prochaine_collecte: '2026-06-25 08:00',
      types_dechets: ['Déchets ménagers résidentiels'],
      coordonnees_gps: '14.8760°N, 15.8550°W',
      notes: 'Quartier résidentiel planifié. Bonne organisation.',
    },
    {
      id: 32,
      nom: 'Bac Route de Darou Mousty',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8550,
      lng: -15.8550,
      adresse: 'Axe route de Darou Mousty',
      quartier: 'Route de Darou Mousty',
      niveau_quartier: 'village',
      capacite_m3: 8,
      taux_remplissage: 67,
      frequence_collecte: 'Quotidienne',
      responsable: 'CADAK-CAR',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Déchets route', 'Ordures ménagères', 'Résidus commerce'],
      coordonnees_gps: '14.8550°N, 15.8550°W',
      notes: 'Axe routier majeur. Fort trafic lors du Magal.',
    },
    {
      id: 33,
      nom: 'Bac Boustanoul',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8720,
      lng: -15.8760,
      adresse: 'Village Boustanoul',
      quartier: 'Boustanoul',
      niveau_quartier: 'village',
      capacite_m3: 4,
      taux_remplissage: 33,
      frequence_collecte: '2x/semaine',
      responsable: 'Comité de village',
      phase_active: ['normale', 'pre-magal'],
      derniere_collecte: '2026-06-23 08:30',
      prochaine_collecte: '2026-06-26 08:30',
      types_dechets: ['Déchets ménagers'],
      coordonnees_gps: '14.8720°N, 15.8760°W',
      notes: 'Petit village bien organisé.',
    },
    {
      id: 34,
      nom: 'PAV Ndindy Abdou',
      type: 'point_apport_volontaire',
      statut: 'actif',
      lat: 14.8740,
      lng: -15.8580,
      adresse: 'Ndindy Abdou, place publique',
      quartier: 'Ndindy Abdou',
      niveau_quartier: 'village',
      capacite_m3: 3,
      taux_remplissage: 29,
      frequence_collecte: '2x/semaine',
      responsable: 'Association jeunesse',
      phase_active: ['normale'],
      derniere_collecte: '2026-06-23 09:00',
      prochaine_collecte: '2026-06-26 09:00',
      types_dechets: ['Déchets ménagers organiques'],
      coordonnees_gps: '14.8740°N, 15.8580°W',
      notes: 'Association de jeunes dynamique.',
    },
    {
      id: 35,
      nom: 'Bac Darou Salam Ndame',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8690,
      lng: -15.8620,
      adresse: 'Darou Salam Ndame',
      quartier: 'Darou Salam Ndame',
      niveau_quartier: 'village',
      capacite_m3: 5,
      taux_remplissage: 50,
      frequence_collecte: '3x/semaine',
      responsable: 'Mairie de Touba',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-23 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Ordures ménagères', 'Résidus organiques'],
      coordonnees_gps: '14.8690°N, 15.8620°W',
      notes: 'Extension récente de Ndame.',
    },
    // ══════════════════════════════════════════════════════════════
    // ZONES PÉRIPHÉRIQUES EST
    // ══════════════════════════════════════════════════════════════
    {
      id: 36,
      nom: 'Bac Touba Bagdad',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8610,
      lng: -15.8570,
      adresse: 'Avenue principale Touba Bagdad',
      quartier: 'Touba Bagdad',
      niveau_quartier: 'peripherique',
      capacite_m3: 8,
      taux_remplissage: 74,
      frequence_collecte: 'Quotidienne',
      responsable: 'CADAK-CAR',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 07:00',
      prochaine_collecte: '2026-06-25 07:00',
      types_dechets: ['Ordures ménagères', 'Déchets organiques'],
      coordonnees_gps: '14.8610°N, 15.8570°W',
      notes: 'Quartier récent en forte croissance démographique.',
    },
    {
      id: 37,
      nom: 'Bac Mbacké Bâri',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8510,
      lng: -15.8400,
      adresse: 'Centre Mbacké Bâri',
      quartier: 'Mbacké Bâri',
      niveau_quartier: 'peripherique',
      capacite_m3: 6,
      taux_remplissage: 58,
      frequence_collecte: '3x/semaine',
      responsable: 'Mairie de Touba',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-23 08:00',
      prochaine_collecte: '2026-06-25 08:00',
      types_dechets: ['Ordures ménagères'],
      coordonnees_gps: '14.8510°N, 15.8400°W',
      notes: 'Zone périphérique est.',
    },
    {
      id: 38,
      nom: 'PAV Touba Wadane',
      type: 'point_apport_volontaire',
      statut: 'actif',
      lat: 14.8900,
      lng: -15.8700,
      adresse: 'Touba Wadane, carrefour',
      quartier: 'Touba Wadane',
      niveau_quartier: 'peripherique',
      capacite_m3: 5,
      taux_remplissage: 36,
      frequence_collecte: '2x/semaine',
      responsable: 'Comité de quartier',
      phase_active: ['normale', 'pre-magal'],
      derniere_collecte: '2026-06-23 08:00',
      prochaine_collecte: '2026-06-26 08:00',
      types_dechets: ['Déchets ménagers'],
      coordonnees_gps: '14.8900°N, 15.8700°W',
      notes: 'Zone nord en développement.',
    },
    {
      id: 39,
      nom: 'Bac Diakhaye',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8480,
      lng: -15.8600,
      adresse: 'Village Diakhaye',
      quartier: 'Diakhaye',
      niveau_quartier: 'peripherique',
      capacite_m3: 4,
      taux_remplissage: 41,
      frequence_collecte: '2x/semaine',
      responsable: 'Comité de village',
      phase_active: ['normale', 'pre-magal'],
      derniere_collecte: '2026-06-23 09:00',
      prochaine_collecte: '2026-06-26 09:00',
      types_dechets: ['Ordures ménagères', 'Résidus agricoles'],
      coordonnees_gps: '14.8480°N, 15.8600°W',
      notes: 'Village rural semi-intégré.',
    },
    {
      id: 40,
      nom: 'Bac NDindy',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8830,
      lng: -15.8580,
      adresse: 'NDindy, avenue principale',
      quartier: 'NDindy',
      niveau_quartier: 'peripherique',
      capacite_m3: 5,
      taux_remplissage: 46,
      frequence_collecte: '3x/semaine',
      responsable: 'GIE NDindy',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-23 07:30',
      prochaine_collecte: '2026-06-25 07:30',
      types_dechets: ['Ordures ménagères'],
      coordonnees_gps: '14.8830°N, 15.8580°W',
      notes: 'Zone nord-est.',
    },
    {
      id: 41,
      nom: 'Bac Taif',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8460,
      lng: -15.8750,
      adresse: 'Taif, rue principale',
      quartier: 'Taif',
      niveau_quartier: 'peripherique',
      capacite_m3: 5,
      taux_remplissage: 39,
      frequence_collecte: '2x/semaine',
      responsable: 'Mairie de Touba',
      phase_active: ['normale', 'pre-magal'],
      derniere_collecte: '2026-06-23 09:00',
      prochaine_collecte: '2026-06-26 09:00',
      types_dechets: ['Ordures ménagères'],
      coordonnees_gps: '14.8460°N, 15.8750°W',
      notes: 'Quartier sud en extension.',
    },
    // ══════════════════════════════════════════════════════════════
    // ZONES PÉRIPHÉRIQUES — Nouveaux quartiers
    // ══════════════════════════════════════════════════════════════
    {
      id: 42,
      nom: 'PAV Touba Ndiarème',
      type: 'point_apport_volontaire',
      statut: 'actif',
      lat: 14.8880,
      lng: -15.8550,
      adresse: 'Touba Ndiarème, place centrale',
      quartier: 'Touba Ndiarème',
      niveau_quartier: 'peripherique',
      capacite_m3: 4,
      taux_remplissage: 32,
      frequence_collecte: '2x/semaine',
      responsable: 'Association résidents',
      phase_active: ['normale', 'pre-magal'],
      derniere_collecte: '2026-06-23 09:00',
      prochaine_collecte: '2026-06-26 09:00',
      types_dechets: ['Déchets ménagers résidentiels'],
      coordonnees_gps: '14.8880°N, 15.8550°W',
      notes: 'Nouveau quartier résidentiel.',
    },
    {
      id: 43,
      nom: 'Bac Bélel',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8540,
      lng: -15.8480,
      adresse: 'Bélel, axe principal',
      quartier: 'Bélel',
      niveau_quartier: 'peripherique',
      capacite_m3: 4,
      taux_remplissage: 35,
      frequence_collecte: '2x/semaine',
      responsable: 'Mairie de Touba',
      phase_active: ['normale', 'pre-magal'],
      derniere_collecte: '2026-06-23 09:00',
      prochaine_collecte: '2026-06-26 09:00',
      types_dechets: ['Ordures ménagères'],
      coordonnees_gps: '14.8540°N, 15.8480°W',
      notes: 'Zone est, faible densité.',
    },
    {
      id: 44,
      nom: 'Bac Sourah',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8920,
      lng: -15.8600,
      adresse: 'Sourah, route principale',
      quartier: 'Sourah',
      niveau_quartier: 'peripherique',
      capacite_m3: 5,
      taux_remplissage: 43,
      frequence_collecte: '3x/semaine',
      responsable: 'Comité de quartier',
      phase_active: ['normale', 'pre-magal'],
      derniere_collecte: '2026-06-23 08:00',
      prochaine_collecte: '2026-06-25 08:00',
      types_dechets: ['Ordures ménagères'],
      coordonnees_gps: '14.8920°N, 15.8600°W',
      notes: 'Quartier nord récent.',
    },
    {
      id: 45,
      nom: 'Bac Mbal',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8430,
      lng: -15.8900,
      adresse: 'Mbal, carrefour',
      quartier: 'Mbal',
      niveau_quartier: 'peripherique',
      capacite_m3: 4,
      taux_remplissage: 28,
      frequence_collecte: '2x/semaine',
      responsable: 'GIE Mbal',
      phase_active: ['normale'],
      derniere_collecte: '2026-06-22 09:00',
      prochaine_collecte: '2026-06-26 09:00',
      types_dechets: ['Ordures ménagères', 'Résidus agricoles'],
      coordonnees_gps: '14.8430°N, 15.8900°W',
      notes: 'Zone rurale en voie d\'urbanisation.',
    },
    // ══════════════════════════════════════════════════════════════
    // AUTRES ZONES PÉRIPHÉRIQUES
    // ══════════════════════════════════════════════════════════════
    {
      id: 46,
      nom: 'Bac Loyène',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8480,
      lng: -15.8980,
      adresse: 'Loyène, route de Mbacké',
      quartier: 'Loyène',
      niveau_quartier: 'peripherique',
      capacite_m3: 6,
      taux_remplissage: 52,
      frequence_collecte: '3x/semaine',
      responsable: 'CADAK-CAR',
      phase_active: ['normale', 'pre-magal', 'magal'],
      derniere_collecte: '2026-06-23 08:00',
      prochaine_collecte: '2026-06-25 08:00',
      types_dechets: ['Ordures ménagères'],
      coordonnees_gps: '14.8480°N, 15.8980°W',
      notes: 'Zone sud-ouest, axe Mbacké.',
    },
    {
      id: 47,
      nom: 'Bac Kenya',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8950,
      lng: -15.8750,
      adresse: 'Kenya, avenue principale',
      quartier: 'Kenya',
      niveau_quartier: 'peripherique',
      capacite_m3: 5,
      taux_remplissage: 37,
      frequence_collecte: '2x/semaine',
      responsable: 'Association Kenya',
      phase_active: ['normale', 'pre-magal'],
      derniere_collecte: '2026-06-23 08:30',
      prochaine_collecte: '2026-06-26 08:30',
      types_dechets: ['Déchets ménagers'],
      coordonnees_gps: '14.8950°N, 15.8750°W',
      notes: 'Quartier nord-ouest.',
    },
    {
      id: 48,
      nom: 'Bac Djibock',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8400,
      lng: -15.8700,
      adresse: 'Djibock, centre',
      quartier: 'Djibock',
      niveau_quartier: 'peripherique',
      capacite_m3: 4,
      taux_remplissage: 30,
      frequence_collecte: '2x/semaine',
      responsable: 'Comité de village',
      phase_active: ['normale'],
      derniere_collecte: '2026-06-22 09:00',
      prochaine_collecte: '2026-06-25 09:00',
      types_dechets: ['Ordures ménagères', 'Résidus agricoles'],
      coordonnees_gps: '14.8400°N, 15.8700°W',
      notes: 'Village rural méridional.',
    },
    {
      id: 49,
      nom: 'Bac Lyndiane',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8560,
      lng: -15.9050,
      adresse: 'Lyndiane, zone périphérique',
      quartier: 'Lyndiane',
      niveau_quartier: 'peripherique',
      capacite_m3: 5,
      taux_remplissage: 45,
      frequence_collecte: '2x/semaine',
      responsable: 'Mairie de Touba',
      phase_active: ['normale', 'pre-magal'],
      derniere_collecte: '2026-06-23 09:00',
      prochaine_collecte: '2026-06-26 09:00',
      types_dechets: ['Ordures ménagères'],
      coordonnees_gps: '14.8560°N, 15.9050°W',
      notes: 'Zone sud-ouest lointaine.',
    },
    {
      id: 50,
      nom: 'Bac Diabir',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8950,
      lng: -15.8450,
      adresse: 'Diabir, route principale',
      quartier: 'Diabir',
      niveau_quartier: 'peripherique',
      capacite_m3: 4,
      taux_remplissage: 34,
      frequence_collecte: '2x/semaine',
      responsable: 'GIE Diabir',
      phase_active: ['normale'],
      derniere_collecte: '2026-06-22 09:00',
      prochaine_collecte: '2026-06-25 09:00',
      types_dechets: ['Ordures ménagères'],
      coordonnees_gps: '14.8950°N, 15.8450°W',
      notes: 'Zone nord-est éloignée.',
    },
    // ══════════════════════════════════════════════════════════════
    // SITES DE VALORISATION & SPÉCIAUX
    // ══════════════════════════════════════════════════════════════
    {
      id: 51,
      nom: 'Unité Biogaz Route Mbacké',
      type: 'unite_biogaz',
      statut: 'actif',
      lat: 14.8520,
      lng: -15.8980,
      adresse: 'Route de Mbacké, km 3',
      quartier: 'Keur Niang',
      niveau_quartier: 'historique',
      capacite_m3: 200,
      taux_remplissage: 42,
      frequence_collecte: 'Quotidienne',
      responsable: 'Projet ENDA Énergie',
      phase_active: ['normale', 'post-magal'],
      derniere_collecte: '2026-06-24 06:00',
      prochaine_collecte: '2026-06-25 06:00',
      types_dechets: ['Déchets organiques mixtes', 'Lisier', 'Graisses alimentaires'],
      coordonnees_gps: '14.8520°N, 15.8980°W',
      notes: "Unité pilote biogaz. Production pour ~50 foyers.",
    },
    {
      id: 52,
      nom: 'PAV Université Cheikhoul Khadim',
      type: 'point_apport_volontaire',
      statut: 'actif',
      lat: 14.8820,
      lng: -15.8690,
      adresse: 'Campus UCK, zone universitaire',
      quartier: 'Touba Wadane',
      niveau_quartier: 'peripherique',
      capacite_m3: 3,
      taux_remplissage: 28,
      frequence_collecte: '3x/semaine',
      responsable: 'Club Environnement UCK',
      phase_active: ['normale'],
      derniere_collecte: '2026-06-23 12:00',
      prochaine_collecte: '2026-06-25 12:00',
      types_dechets: ['Déchets restauration univ.', 'Résidus organiques'],
      coordonnees_gps: '14.8820°N, 15.8690°W',
      notes: "Initiative étudiante. Jardin compost du campus.",
    },
    {
      id: 53,
      nom: 'Bac Marché Bétail',
      type: 'bac_ordures',
      statut: 'actif',
      lat: 14.8480,
      lng: -15.8650,
      adresse: 'Marché à bétail, périphérie Sud',
      quartier: 'Diakhaye',
      niveau_quartier: 'peripherique',
      capacite_m3: 15,
      taux_remplissage: 62,
      frequence_collecte: 'Quotidienne',
      responsable: 'Services Vétérinaires + Mairie',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 07:30',
      prochaine_collecte: '2026-06-25 07:30',
      types_dechets: ['Fumier', 'Résidus organiques animaux', 'Déchets verts'],
      coordonnees_gps: '14.8480°N, 15.8650°W',
      notes: 'Source importante de biomasse pour biogaz.',
    },
    {
      id: 54,
      nom: 'Centre de Tri Secondaire Est',
      type: 'centre_tri',
      statut: 'actif',
      lat: 14.8620,
      lng: -15.8530,
      adresse: 'Zone industrielle Est Touba',
      quartier: 'Mbacké Bâri',
      niveau_quartier: 'peripherique',
      capacite_m3: 50,
      taux_remplissage: 38,
      frequence_collecte: 'Quotidienne',
      responsable: 'Mairie de Touba',
      phase_active: ['normale', 'pre-magal', 'magal', 'post-magal'],
      derniere_collecte: '2026-06-24 05:00',
      prochaine_collecte: '2026-06-25 05:00',
      types_dechets: ['Fraction organique', 'Matières recyclables'],
      coordonnees_gps: '14.8620°N, 15.8530°W',
      notes: 'Centre de tri secondaire pour zone est.',
    },
    {
      id: 55,
      nom: 'Plateforme Compostage Sud',
      type: 'plateforme_compostage',
      statut: 'actif',
      lat: 14.8440,
      lng: -15.8820,
      adresse: 'Périphérie sud Touba',
      quartier: 'Taif',
      niveau_quartier: 'peripherique',
      capacite_m3: 80,
      taux_remplissage: 25,
      frequence_collecte: 'Hebdomadaire',
      responsable: 'ONG Green Touba',
      phase_active: ['normale', 'post-magal'],
      derniere_collecte: '2026-06-21 09:00',
      prochaine_collecte: '2026-06-28 09:00',
      types_dechets: ['Déchets verts', 'Matières organiques'],
      coordonnees_gps: '14.8440°N, 15.8820°W',
      notes: 'Nouveau site compostage zone sud.',
    },
    // ══════════════════════════════════════════════════════════════
    // POINTS TEMPORAIRES MAGAL (actifs uniquement en période Magal)
    // ══════════════════════════════════════════════════════════════
    {
      id: 56,
      nom: 'Point Magal — Axe Nord Grande Mosquée',
      type: 'bac_ordures',
      statut: 'inactif',
      lat: 14.8715,
      lng: -15.8825,
      adresse: 'Axe pèlerinage Nord Mosquée',
      quartier: 'Touba Mosquée',
      niveau_quartier: 'historique',
      capacite_m3: 5,
      taux_remplissage: 0,
      frequence_collecte: 'Magal uniquement',
      responsable: 'Comité Magal Environnement',
      phase_active: ['magal'],
      derniere_collecte: 'N/A',
      prochaine_collecte: 'Avant Magal 2026',
      types_dechets: ['Déchets pèlerins', 'Résidus repas communautaires'],
      coordonnees_gps: '14.8715°N, 15.8825°W',
      notes: 'Bac temporaire déployé uniquement pendant le Magal.',
    },
    {
      id: 57,
      nom: 'Point Magal — Axe Darou Khoudoss',
      type: 'bac_ordures',
      statut: 'inactif',
      lat: 14.8750,
      lng: -15.8795,
      adresse: 'Axe pèlerinage Darou Khoudoss',
      quartier: 'Darou Khoudoss',
      niveau_quartier: 'historique',
      capacite_m3: 5,
      taux_remplissage: 0,
      frequence_collecte: 'Magal uniquement',
      responsable: 'Comité Magal Environnement',
      phase_active: ['magal'],
      derniere_collecte: 'N/A',
      prochaine_collecte: 'Avant Magal 2026',
      types_dechets: ['Déchets pèlerins'],
      coordonnees_gps: '14.8750°N, 15.8795°W',
      notes: 'Déployé uniquement pendant le Grand Magal.',
    },
    {
      id: 58,
      nom: 'Point Magal — Gouye Mbind',
      type: 'bac_ordures',
      statut: 'inactif',
      lat: 14.8608,
      lng: -15.8858,
      adresse: 'Axe pèlerinage Gouye Mbind',
      quartier: 'Gouye Mbind',
      niveau_quartier: 'historique',
      capacite_m3: 5,
      taux_remplissage: 0,
      frequence_collecte: 'Magal uniquement',
      responsable: 'Comité Magal Environnement',
      phase_active: ['magal'],
      derniere_collecte: 'N/A',
      prochaine_collecte: 'Avant Magal 2026',
      types_dechets: ['Déchets pèlerins', 'Restes repas daharas'],
      coordonnees_gps: '14.8608°N, 15.8858°W',
      notes: 'Point temporaire axe pèlerinage ouest.',
    },
    {
      id: 59,
      nom: 'PAV École Samer',
      type: 'point_apport_volontaire',
      statut: 'actif',
      lat: 14.8635,
      lng: -15.8745,
      adresse: 'École Samer, allée est',
      quartier: 'Samer',
      niveau_quartier: 'historique',
      capacite_m3: 2,
      taux_remplissage: 22,
      frequence_collecte: '2x/semaine',
      responsable: 'APE Samer',
      phase_active: ['normale'],
      derniere_collecte: '2026-06-23 08:00',
      prochaine_collecte: '2026-06-26 08:00',
      types_dechets: ['Déchets scolaires'],
      coordonnees_gps: '14.8635°N, 15.8745°W',
      notes: 'Programme éducation environnementale.',
    },
    {
      id: 60,
      nom: 'Centre Collecte Dianatoul Mahwa',
      type: 'centre_tri',
      statut: 'en_construction',
      lat: 14.8598,
      lng: -15.8792,
      adresse: 'Zone nord-est, Dianatoul Mahwa',
      quartier: 'Dianatoul Mahwa',
      niveau_quartier: 'historique',
      capacite_m3: 30,
      taux_remplissage: 0,
      frequence_collecte: 'Prévu Quotidienne',
      responsable: 'Mairie de Touba',
      phase_active: ['pre-magal', 'magal', 'post-magal'],
      derniere_collecte: 'N/A',
      prochaine_collecte: 'Ouverture prévue 2026-Q3',
      types_dechets: ['Déchets organiques triés'],
      coordonnees_gps: '14.8598°N, 15.8792°W',
      notes: 'En construction. Inauguration prévue Q3 2026.',
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
  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml"/>

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
    <a href="/agent" style="padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(8,145,178,.2);color:#38bdf8;border:1px solid #38bdf8;text-decoration:none;display:flex;align-items:center;gap:4px">
      <i class="fas fa-mobile-alt"></i> Agent
    </a>
    <a href="/alertes" style="padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(239,68,68,.2);color:#f87171;border:1px solid #f87171;text-decoration:none;display:flex;align-items:center;gap:4px">
      <i class="fas fa-bell"></i> Alertes
    </a>
    <a href="/export" style="padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(124,58,237,.2);color:#a78bfa;border:1px solid #a78bfa;text-decoration:none;display:flex;align-items:center;gap:4px">
      <i class="fas fa-download"></i> QGIS
    </a>
    <a href="/certificat" style="padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(16,185,129,.2);color:#34d399;border:1px solid #34d399;text-decoration:none;display:flex;align-items:center;gap:4px">
      <i class="fas fa-certificate"></i> Certificat
    </a>
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
        <div class="stat-card" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3)">
          <div class="stat-value" id="stat-quartiers" style="color:#f59e0b">—</div>
          <div class="stat-label">Quartiers couverts</div>
        </div>
        <div class="stat-card" style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3)">
          <div class="stat-value" id="stat-critiques" style="color:#ef4444">—</div>
          <div class="stat-label">⚠️ Bacs critiques (≥80%)</div>
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
      <div class="filter-group">
        <label class="filter-label">Niveau de quartier</label>
        <select class="filter-select" id="filter-niveau" onchange="applyFilters()">
          <option value="">Tous les niveaux</option>
          <option value="historique">🏛️ Quartiers historiques (13)</option>
          <option value="village">🏘️ Villages urbains (25)</option>
          <option value="peripherique">🌐 Zones périphériques (15+)</option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">Quartier spécifique</label>
        <select class="filter-select" id="filter-quartier" onchange="applyFilters()">
          <option value="">Tous les quartiers</option>
          <optgroup label="── Quartiers historiques ──">
            <option>Darou Khoudoss</option><option>Gouye Mbind</option>
            <option>Darou Miname</option><option>Touba Guédé</option>
            <option>Touba Mosquée</option><option>Keur Niang</option>
            <option>Khaira</option><option>Guédé Bousso</option>
            <option>Samer</option><option>Darou Marnane</option>
            <option>Ndame</option><option>Madiyana</option>
            <option>Dianatoul Mahwa</option>
          </optgroup>
          <optgroup label="── Villages urbains ──">
            <option>Alia</option><option>Arifina</option>
            <option>Boukhatoul Moubarak</option><option>Boustanoul</option>
            <option>Darou Alimoul Khabir</option><option>Darou Khadim</option>
            <option>Darou Marnane 2</option><option>Darou Salam Ndame</option>
            <option>Ndindy Abdou</option><option>Ndamatou 1</option>
            <option>Route de Darou Mousty</option><option>Same Lah</option>
            <option>Touba Al Azhar</option><option>Touba HLM</option>
          </optgroup>
          <optgroup label="── Zones périphériques ──">
            <option>Touba Bagdad</option><option>Mbacké Bâri</option>
            <option>Touba Wadane</option><option>Diakhaye</option>
            <option>NDindy</option><option>Taif</option>
            <option>Touba Ndiarème</option><option>Bélel</option>
            <option>Sourah</option><option>Mbal</option>
            <option>Loyène</option><option>Kenya</option>
            <option>Djibock</option><option>Lyndiane</option><option>Diabir</option>
          </optgroup>
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
      <div class="layer-item">
        <div class="layer-info">
          <div class="layer-dot" style="background:#f59e0b;border:2px solid #92400e"></div>
          <span class="layer-name">Centres de quartiers</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="layer-quartiers" onchange="toggleLayer('quartiers')">
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
let layerGroups = { collecte: null, restaurants: null, projets: null, heatmap: null, quartiers: null }
let allQuartiers = []
let activeFilters = { type: '', statut: ['actif', 'inactif', 'en_construction'], phase: '', niveau: '', quartier: '' }
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
  const typeVal    = document.getElementById('filter-type').value
  const phaseVal   = document.getElementById('filter-phase').value
  const niveauVal  = document.getElementById('filter-niveau').value
  const quartierVal= document.getElementById('filter-quartier').value

  let filtered = allPoints.filter(p => {
    if (typeVal && p.type !== typeVal) return false
    if (!activeFilters.statut.includes(p.statut)) return false
    if (phaseVal && !p.phase_active?.includes(phaseVal)) return false
    if (niveauVal && p.niveau_quartier !== niveauVal) return false
    if (quartierVal && p.quartier !== quartierVal) return false
    return true
  })

  renderPoints(filtered)

  // Mettre à jour le badge de résultats
  const badge = document.getElementById('filter-count')
  if (badge) badge.textContent = filtered.length < allPoints.length
    ? \`\${filtered.length}/\${allPoints.length}\` : allPoints.length
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
  if (document.getElementById('stat-quartiers'))
    document.getElementById('stat-quartiers').textContent = s.total_quartiers || '—'
  if (document.getElementById('stat-critiques'))
    document.getElementById('stat-critiques').textContent = s.points_critiques || 0

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

async function loadQuartiers() {
  try {
    const resp = await axios.get('/api/quartiers')
    allQuartiers = resp.data.data
    layerGroups.quartiers = L.layerGroup()

    const NIVEAU_COLORS = {
      historique:  { fill: '#fef08a', stroke: '#ca8a04', size: 18 },
      village:     { fill: '#bfdbfe', stroke: '#3b82f6', size: 14 },
      peripherique:{ fill: '#fce7f3', stroke: '#ec4899', size: 11 },
    }

    allQuartiers.forEach(q => {
      const cfg = NIVEAU_COLORS[q.niveau] || NIVEAU_COLORS.peripherique
      const marker = L.circleMarker([q.lat, q.lng], {
        radius: cfg.size,
        fillColor: cfg.fill,
        color: cfg.stroke,
        weight: 2,
        opacity: 0.9,
        fillOpacity: 0.5,
      })
      const niveauLabel = q.niveau === 'historique' ? 'Historique' : q.niveau === 'village' ? 'Village urbain' : 'Périphérique'
      marker.bindTooltip(\`
        <div style="font-family:Inter,sans-serif;padding:4px 6px">
          <div style="font-weight:700;font-size:13px">\${q.nom}</div>
          <div style="color:#6b7280;font-size:11px">\${niveauLabel}</div>
          <div style="font-size:11px;margin-top:2px">
            ~\${q.population_est?.toLocaleString()} hab. &bull; \${q.superficie_km2} km²
          </div>
        </div>\`, { direction: 'top', offset: [0, -6] })
      layerGroups.quartiers.addLayer(marker)
    })
  } catch (e) { console.warn('Quartiers non chargés', e) }
}

async function init() {
  initMap()
  await Promise.all([loadStats(), loadPoints(), loadRestaurants(), loadProjets(), loadProtocole(), loadQuartiers()])
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

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// PAGE CERTIFICAT DE TRAÇABILITÉ
// ═══════════════════════════════════════════════════════════════════════════
function getCertificatHtml(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Certificat de Traçabilité — GeoTouba</title>
  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml"/>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Amiri:wght@400;700&display=swap" rel="stylesheet"/>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
  <style>
    :root {
      --primary:#16a34a; --primary-light:#22c55e; --primary-dark:#14532d;
      --accent:#f59e0b; --danger:#ef4444; --info:#0891b2; --purple:#7c3aed;
      --emerald:#10b981; --bg:#0f172a; --surface:#1e293b; --surface2:#0f172a;
      --border:rgba(255,255,255,.08); --text:#e2e8f0; --muted:#94a3b8;
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:var(--bg); color:var(--text); min-height:100vh; }

    /* ── HEADER ── */
    header {
      background:rgba(30,41,59,.95); backdrop-filter:blur(12px);
      border-bottom:1px solid var(--border);
      padding:12px 24px; display:flex; align-items:center; gap:16px;
      position:sticky; top:0; z-index:100;
    }
    .back-btn {
      text-decoration:none; color:var(--muted); font-size:13px;
      display:flex; align-items:center; gap:6px;
      padding:6px 12px; border-radius:8px; border:1px solid var(--border);
      transition:all .2s;
    }
    .back-btn:hover { color:var(--text); border-color:var(--primary); }
    header h1 { font-size:18px; font-weight:800; color:#fff; }
    header .sub { font-size:11px; color:var(--muted); margin-top:2px; }
    .nav-links { margin-left:auto; display:flex; gap:8px; flex-wrap:wrap; }
    .nav-link {
      padding:4px 10px; border-radius:20px; font-size:11px; font-weight:600;
      text-decoration:none; display:flex; align-items:center; gap:4px; border:1px solid;
    }

    /* ── LAYOUT ── */
    main { max-width:1400px; margin:0 auto; padding:24px; display:grid; grid-template-columns:1fr 1fr; gap:24px; }
    @media(max-width:900px){ main{ grid-template-columns:1fr; } }

    /* ── CARD ── */
    .card {
      background:var(--surface); border:1px solid var(--border);
      border-radius:16px; padding:24px;
    }
    .card-title {
      font-size:15px; font-weight:700; color:#fff;
      display:flex; align-items:center; gap:8px; margin-bottom:20px;
      padding-bottom:14px; border-bottom:1px solid var(--border);
    }
    .card-title i { color:var(--primary); }

    /* ── FORM ── */
    .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .form-group { display:flex; flex-direction:column; gap:6px; }
    .form-group.full { grid-column:1/-1; }
    label { font-size:11px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; }
    input, select, textarea {
      background:rgba(255,255,255,.05); border:1px solid var(--border);
      border-radius:10px; padding:10px 14px; color:var(--text);
      font-size:13px; font-family:inherit; transition:border .2s;
      width:100%;
    }
    input:focus, select:focus, textarea:focus { outline:none; border-color:var(--primary); }
    select option { background:#1e293b; }
    textarea { resize:vertical; min-height:70px; }

    /* ── BOUTONS ── */
    .btn {
      padding:12px 20px; border:none; border-radius:10px; font-size:13px;
      font-weight:700; cursor:pointer; transition:all .2s;
      display:inline-flex; align-items:center; gap:8px;
    }
    .btn-primary { background:var(--primary); color:#fff; width:100%; justify-content:center; margin-top:6px; }
    .btn-primary:hover { background:var(--primary-light); transform:translateY(-1px); }
    .btn-print { background:rgba(124,58,237,.15); color:#a78bfa; border:1px solid rgba(124,58,237,.4); }
    .btn-print:hover { background:rgba(124,58,237,.3); }
    .btn-reset { background:rgba(239,68,68,.1); color:#f87171; border:1px solid rgba(239,68,68,.3); }
    .btn-reset:hover { background:rgba(239,68,68,.2); }

    /* ── SLIDER QUANTITÉ ── */
    .qty-display {
      font-size:28px; font-weight:800; color:var(--primary);
      text-align:center; margin:8px 0 4px;
    }
    .qty-unit { font-size:12px; color:var(--muted); text-align:center; margin-bottom:10px; }
    input[type=range] {
      -webkit-appearance:none; height:6px; border-radius:3px;
      background:linear-gradient(to right, var(--primary) 0%, var(--primary) var(--pct,50%), rgba(255,255,255,.1) var(--pct,50%));
      border:none; padding:0; cursor:pointer;
    }
    input[type=range]::-webkit-slider-thumb {
      -webkit-appearance:none; width:20px; height:20px; border-radius:50%;
      background:var(--primary); border:3px solid #fff; cursor:pointer;
    }

    /* ── FACTEUR CO2 PREVIEW ── */
    .co2-preview {
      background:rgba(16,185,129,.08); border:1px solid rgba(16,185,129,.25);
      border-radius:12px; padding:14px; margin-top:12px;
    }
    .co2-preview-title { font-size:10px; font-weight:700; color:var(--emerald); text-transform:uppercase; margin-bottom:8px; }
    .co2-preview-val { font-size:26px; font-weight:800; color:var(--emerald); }
    .co2-preview-sub { font-size:11px; color:var(--muted); }

    /* ── CERTIFICAT VISUEL ── */
    #certificat-container { display:none; }
    .certificat-doc {
      background:linear-gradient(135deg, #0a1a0e 0%, #0f2918 100%);
      border:2px solid var(--primary);
      border-radius:16px; padding:32px;
      position:relative; overflow:hidden;
    }
    .cert-watermark {
      position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg);
      font-size:80px; font-weight:900; color:rgba(22,163,74,.04);
      white-space:nowrap; pointer-events:none; letter-spacing:8px;
    }
    .cert-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:24px; }
    .cert-logo { display:flex; align-items:center; gap:10px; }
    .cert-logo-icon {
      width:48px; height:48px; border-radius:12px;
      background:var(--primary); display:flex; align-items:center; justify-content:center;
      font-size:22px;
    }
    .cert-logo-text { font-size:20px; font-weight:800; color:#fff; }
    .cert-logo-sub { font-size:10px; color:var(--muted); }
    .cert-badge {
      background:rgba(22,163,74,.15); border:1px solid var(--primary);
      border-radius:8px; padding:6px 14px; font-size:11px; font-weight:700;
      color:var(--primary-light); display:flex; align-items:center; gap:6px;
    }
    .cert-title-block { text-align:center; margin-bottom:24px; }
    .cert-title-block h2 {
      font-size:22px; font-weight:800; color:#fff; letter-spacing:1px;
      text-transform:uppercase;
    }
    .cert-title-block .cert-num {
      font-size:13px; color:var(--muted); margin-top:4px; font-family:monospace;
    }
    .cert-divider {
      border:none; border-top:1px solid rgba(22,163,74,.3);
      margin:16px 0;
    }

    /* Grille infos certificat */
    .cert-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px; }
    @media(max-width:600px){ .cert-grid{ grid-template-columns:1fr; } }
    .cert-field { background:rgba(255,255,255,.03); border-radius:10px; padding:12px 14px; }
    .cert-field-label { font-size:9px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.8px; margin-bottom:4px; }
    .cert-field-value { font-size:14px; font-weight:700; color:#fff; }
    .cert-field-value.big { font-size:22px; color:var(--primary-light); }
    .cert-field-value.co2 { font-size:22px; color:var(--emerald); }

    /* Impact visuel */
    .cert-impact {
      background:rgba(16,185,129,.08); border:1px solid rgba(16,185,129,.2);
      border-radius:12px; padding:16px; margin-bottom:20px;
    }
    .cert-impact-title { font-size:11px; font-weight:700; color:var(--emerald); margin-bottom:12px; text-transform:uppercase; }
    .cert-impact-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
    @media(max-width:500px){ .cert-impact-grid{ grid-template-columns:1fr; } }
    .cert-impact-item { text-align:center; }
    .cert-impact-icon { font-size:24px; margin-bottom:4px; }
    .cert-impact-val { font-size:16px; font-weight:800; color:#fff; }
    .cert-impact-lbl { font-size:9px; color:var(--muted); }

    /* Pied de certificat */
    .cert-footer {
      display:flex; align-items:center; justify-content:space-between;
      margin-top:20px; padding-top:16px; border-top:1px solid rgba(22,163,74,.2);
      gap:12px;
    }
    .cert-footer-left { font-size:10px; color:var(--muted); line-height:1.6; }
    .cert-footer-left strong { color:var(--text); }
    #cert-qr-canvas { border-radius:8px; background:#fff; padding:6px; }
    .cert-signature {
      text-align:center; font-size:9px; color:rgba(22,163,74,.5);
      margin-top:16px; letter-spacing:2px; font-family:monospace;
    }

    /* Boutons action certificat */
    .cert-actions { display:flex; gap:10px; margin-top:16px; flex-wrap:wrap; }

    /* ── HISTORIQUE ── */
    .hist-item {
      background:rgba(255,255,255,.03); border:1px solid var(--border);
      border-radius:10px; padding:12px 14px; margin-bottom:8px;
      display:flex; align-items:center; gap:12px; cursor:pointer;
      transition:border-color .2s;
    }
    .hist-item:hover { border-color:var(--primary); }
    .hist-icon {
      width:38px; height:38px; border-radius:10px;
      background:rgba(22,163,74,.15); display:flex; align-items:center;
      justify-content:center; font-size:16px; flex-shrink:0;
    }
    .hist-num { font-size:11px; font-family:monospace; color:var(--primary-light); }
    .hist-type { font-size:13px; font-weight:600; color:#fff; }
    .hist-meta { font-size:11px; color:var(--muted); }
    .hist-co2 { margin-left:auto; text-align:right; }
    .hist-co2-val { font-size:15px; font-weight:800; color:var(--emerald); }
    .hist-co2-lbl { font-size:9px; color:var(--muted); }

    /* ── STATS GLOBALES ── */
    .global-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:20px; }
    .g-stat { background:rgba(255,255,255,.04); border-radius:10px; padding:14px; text-align:center; }
    .g-stat-val { font-size:22px; font-weight:800; color:var(--primary-light); }
    .g-stat-lbl { font-size:10px; color:var(--muted); margin-top:2px; }

    /* ── PRINT ── */
    @media print {
      body { background:#fff !important; color:#000 !important; }
      header, .card:not(.print-zone), .cert-actions, nav { display:none !important; }
      .certificat-doc {
        background:#fff !important; border:2px solid #16a34a !important;
        color:#000 !important; print-color-adjust:exact;
      }
      .cert-field { background:#f0fdf4 !important; }
      .cert-impact { background:#f0fdf4 !important; }
    }
  </style>
</head>
<body>

<!-- HEADER -->
<header>
  <a class="back-btn" href="/"><i class="fas fa-arrow-left"></i> Carte</a>
  <div>
    <h1><i class="fas fa-certificate" style="color:#10b981;margin-right:8px"></i>Certificats de Traçabilité — GeoTouba</h1>
    <p class="sub">Génération & vérification de certificats d'impact environnemental</p>
  </div>
  <div class="nav-links">
    <a class="nav-link" href="/agent"    style="background:rgba(8,145,178,.2);color:#38bdf8;border-color:#38bdf8"><i class="fas fa-mobile-alt"></i> Agent</a>
    <a class="nav-link" href="/alertes"  style="background:rgba(239,68,68,.2);color:#f87171;border-color:#f87171"><i class="fas fa-bell"></i> Alertes</a>
    <a class="nav-link" href="/export"   style="background:rgba(124,58,237,.2);color:#a78bfa;border-color:#a78bfa"><i class="fas fa-download"></i> QGIS</a>
  </div>
</header>

<main>
<!-- ═══════════════════════════════════════════════════════════════
     COLONNE GAUCHE : Formulaire de génération
════════════════════════════════════════════════════════════════ -->
<div>

  <!-- Formulaire -->
  <div class="card" style="margin-bottom:20px">
    <div class="card-title"><i class="fas fa-plus-circle"></i> Générer un certificat</div>

    <div class="form-grid">
      <!-- Type de déchet -->
      <div class="form-group full">
        <label><i class="fas fa-recycle"></i> Type de déchet collecté *</label>
        <select id="f-type" onchange="updatePreview()">
          <option value="">— Sélectionnez le type —</option>
          <option value="dechets_alimentaires">🍽️ Déchets alimentaires</option>
          <option value="residus_vegetaux">🌿 Résidus végétaux / verts</option>
          <option value="fumier_animal">🐄 Fumier / lisier animal</option>
          <option value="huiles_graisses">🫙 Huiles et graisses alimentaires</option>
          <option value="residus_marche">🛒 Résidus de marché</option>
          <option value="boues_organiques">💧 Boues organiques</option>
          <option value="dechets_dahira">🕌 Déchets daharas / communautaires</option>
          <option value="organique_mixte">♻️ Organique mixte</option>
          <option value="dechets_verts">🌱 Déchets verts / jardins</option>
          <option value="dechets_maraichage">🥬 Résidus maraîchage</option>
        </select>
      </div>

      <!-- Quantité -->
      <div class="form-group full">
        <label><i class="fas fa-weight-hanging"></i> Quantité collectée *</label>
        <div class="qty-display" id="qty-display">0</div>
        <div class="qty-unit" id="qty-unit">kilogrammes (kg)</div>
        <input type="range" id="f-qty-slider" min="1" max="5000" value="100" step="1"
          oninput="updateQty(this.value)" style="margin-bottom:8px">
        <div style="display:flex;gap:8px;align-items:center">
          <input type="number" id="f-qty" min="0.1" step="0.1" value="100" placeholder="ex: 250"
            style="flex:1" oninput="syncSlider(this.value); updatePreview()">
          <select id="f-unite" style="width:100px" onchange="updatePreview()">
            <option value="kg">kg</option>
            <option value="tonnes">tonnes</option>
          </select>
        </div>
      </div>

      <!-- Prévisualisation CO2 -->
      <div class="form-group full" id="co2-preview-block" style="display:none">
        <div class="co2-preview">
          <div class="co2-preview-title"><i class="fas fa-leaf"></i> Estimation CO₂ évité</div>
          <div style="display:flex;align-items:baseline;gap:8px">
            <div class="co2-preview-val" id="co2-val">—</div>
            <div class="co2-preview-sub">kg CO₂eq évité</div>
          </div>
          <div style="margin-top:6px;display:flex;gap:16px;font-size:11px;color:var(--muted)">
            <span>🌳 <span id="co2-arbres">—</span> arbres/an</span>
            <span>🚗 <span id="co2-km">—</span> km voiture</span>
            <span>📖 Méthode : <span id="co2-methode" style="color:var(--text)">—</span></span>
          </div>
        </div>
      </div>

      <!-- Point de collecte -->
      <div class="form-group">
        <label><i class="fas fa-map-marker-alt"></i> Point de collecte</label>
        <select id="f-point">
          <option value="">— Sélectionnez —</option>
        </select>
      </div>

      <!-- Quartier -->
      <div class="form-group">
        <label><i class="fas fa-map"></i> Quartier</label>
        <select id="f-quartier">
          <optgroup label="── Quartiers historiques ──">
            <option>Darou Khoudoss</option><option>Gouye Mbind</option>
            <option>Darou Miname</option><option>Touba Guédé</option>
            <option>Touba Mosquée</option><option>Keur Niang</option>
            <option>Khaira</option><option>Guédé Bousso</option>
            <option>Samer</option><option>Darou Marnane</option>
            <option>Ndame</option><option>Madiyana</option>
            <option>Dianatoul Mahwa</option>
          </optgroup>
          <optgroup label="── Villages urbains ──">
            <option>Alia</option><option>Arifina</option>
            <option>Boukhatoul Moubarak</option><option>Darou Khadim</option>
            <option>Darou Marnane 2</option><option>Darou Salam Ndame</option>
            <option>Ndamatou 1</option><option>Same Lah</option>
            <option>Touba Al Azhar</option><option>Touba HLM</option>
          </optgroup>
          <optgroup label="── Zones périphériques ──">
            <option>Touba Bagdad</option><option>Mbacké Bâri</option>
            <option>Touba Wadane</option><option>Diakhaye</option>
            <option>Taif</option><option>Loyène</option>
            <option>Kenya</option><option>Lyndiane</option>
          </optgroup>
        </select>
      </div>

      <!-- Opérateur -->
      <div class="form-group">
        <label><i class="fas fa-user-hard-hat"></i> Opérateur / Agent</label>
        <input type="text" id="f-operateur" placeholder="Nom de l'agent ou structure">
      </div>

      <!-- Destination -->
      <div class="form-group">
        <label><i class="fas fa-industry"></i> Destination valorisation</label>
        <select id="f-destination">
          <option value="Compostage">🌱 Compostage</option>
          <option value="Biogaz">⚡ Production biogaz</option>
          <option value="Épandage agricole">🌾 Épandage agricole</option>
          <option value="Centre de tri">🔄 Centre de tri</option>
          <option value="Valorisation énergétique">🔥 Valorisation énergétique</option>
          <option value="Alimentation animale">🐄 Alimentation animale</option>
          <option value="En attente">⏳ En attente</option>
        </select>
      </div>

      <!-- Date collecte -->
      <div class="form-group">
        <label><i class="fas fa-calendar-alt"></i> Date de collecte</label>
        <input type="date" id="f-date">
      </div>

      <!-- Notes -->
      <div class="form-group full">
        <label><i class="fas fa-sticky-note"></i> Notes complémentaires</label>
        <textarea id="f-notes" placeholder="Conditions de collecte, qualité, remarques particulières..."></textarea>
      </div>
    </div>

    <button class="btn btn-primary" onclick="genererCertificat()">
      <i class="fas fa-certificate"></i> Générer le certificat officiel
    </button>
  </div>

  <!-- Vérificateur -->
  <div class="card">
    <div class="card-title"><i class="fas fa-search"></i> Vérifier un certificat</div>
    <div style="display:flex;gap:10px">
      <input type="text" id="verif-num" placeholder="Ex: GTO-20260629-XYZ12" style="flex:1;font-family:monospace">
      <button class="btn" style="background:rgba(8,145,178,.15);color:#38bdf8;border:1px solid rgba(8,145,178,.4)" onclick="verifierCertificat()">
        <i class="fas fa-check-circle"></i> Vérifier
      </button>
    </div>
    <div id="verif-result" style="display:none;margin-top:12px;padding:12px;border-radius:10px;font-size:13px"></div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════
     COLONNE DROITE : Certificat + historique
════════════════════════════════════════════════════════════════ -->
<div>

  <!-- Placeholder avant génération -->
  <div class="card" id="cert-placeholder">
    <div style="text-align:center;padding:60px 20px;color:var(--muted)">
      <div style="font-size:64px;margin-bottom:16px;opacity:.3">🏅</div>
      <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:8px">Aucun certificat généré</div>
      <div style="font-size:13px">Remplissez le formulaire et cliquez sur<br><strong style="color:var(--primary)">Générer le certificat</strong></div>
    </div>
  </div>

  <!-- Certificat généré -->
  <div id="certificat-container">
    <!-- Boutons action -->
    <div class="cert-actions" style="margin-bottom:12px">
      <button class="btn btn-print" onclick="window.print()"><i class="fas fa-print"></i> Imprimer</button>
      <button class="btn btn-print" onclick="telechargerCertificat()"><i class="fas fa-file-pdf"></i> PDF</button>
      <button class="btn btn-reset" onclick="resetCertificat()"><i class="fas fa-redo"></i> Nouveau</button>
    </div>

    <!-- Le certificat visuel -->
    <div class="certificat-doc print-zone" id="cert-doc">
      <div class="cert-watermark">GÉOTOUBA</div>

      <!-- En-tête -->
      <div class="cert-header">
        <div class="cert-logo">
          <div class="cert-logo-icon">🗺️</div>
          <div>
            <div class="cert-logo-text">GeoTouba SIG</div>
            <div class="cert-logo-sub">Portail SIG — Déchets Organiques</div>
          </div>
        </div>
        <div class="cert-badge">
          <i class="fas fa-check-circle"></i> CERTIFIÉ VALIDE
        </div>
      </div>

      <!-- Titre -->
      <div class="cert-title-block">
        <h2>📜 Certificat de Traçabilité</h2>
        <div class="cert-num" id="cert-numero">N° GTO-XXXXXXXX-XXXXX</div>
      </div>
      <hr class="cert-divider">

      <!-- Infos principales -->
      <div class="cert-grid">
        <div class="cert-field">
          <div class="cert-field-label">♻️ Type de déchet</div>
          <div class="cert-field-value" id="cert-type-label">—</div>
        </div>
        <div class="cert-field">
          <div class="cert-field-label">⚖️ Quantité collectée</div>
          <div class="cert-field-value big" id="cert-quantite">—</div>
        </div>
        <div class="cert-field">
          <div class="cert-field-label">📍 Point de collecte</div>
          <div class="cert-field-value" id="cert-point">—</div>
        </div>
        <div class="cert-field">
          <div class="cert-field-label">🗺️ Quartier</div>
          <div class="cert-field-value" id="cert-quartier">—</div>
        </div>
        <div class="cert-field">
          <div class="cert-field-label">🏭 Destination</div>
          <div class="cert-field-value" id="cert-destination">—</div>
        </div>
        <div class="cert-field">
          <div class="cert-field-label">👤 Opérateur</div>
          <div class="cert-field-value" id="cert-operateur">—</div>
        </div>
        <div class="cert-field">
          <div class="cert-field-label">📅 Date de collecte</div>
          <div class="cert-field-value" id="cert-date-collecte">—</div>
        </div>
        <div class="cert-field" style="background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.3)">
          <div class="cert-field-label" style="color:var(--emerald)">🌍 CO₂ évité</div>
          <div class="cert-field-value co2" id="cert-co2">—</div>
        </div>
      </div>

      <!-- Impact environnemental -->
      <div class="cert-impact">
        <div class="cert-impact-title"><i class="fas fa-leaf"></i> Équivalences d'impact environnemental</div>
        <div class="cert-impact-grid">
          <div class="cert-impact-item">
            <div class="cert-impact-icon">🌳</div>
            <div class="cert-impact-val" id="cert-arbres">—</div>
            <div class="cert-impact-lbl">arbres plantés (1 an)</div>
          </div>
          <div class="cert-impact-item">
            <div class="cert-impact-icon">🚗</div>
            <div class="cert-impact-val" id="cert-km">—</div>
            <div class="cert-impact-lbl">km en voiture évités</div>
          </div>
          <div class="cert-impact-item">
            <div class="cert-impact-icon">💡</div>
            <div class="cert-impact-val" id="cert-foyers">—</div>
            <div class="cert-impact-lbl">foyers électrifiés (jours)</div>
          </div>
        </div>
      </div>

      <!-- Méthode de calcul -->
      <div style="background:rgba(255,255,255,.03);border-radius:10px;padding:12px;margin-bottom:16px;font-size:11px;color:var(--muted);line-height:1.7">
        <strong style="color:var(--text)">📐 Méthode de calcul :</strong> <span id="cert-methode">—</span><br>
        <strong style="color:var(--text)">📚 Référentiel :</strong> ADEME 2023 · GIZ Sénégal · IPCC AR6 WG3<br>
        <strong style="color:var(--text)">📝 Notes :</strong> <span id="cert-notes">—</span>
      </div>

      <!-- Pied du certificat -->
      <div class="cert-footer">
        <div class="cert-footer-left">
          <div>📅 <strong>Date d'émission :</strong> <span id="cert-date-emission">—</span></div>
          <div>🔒 <strong>Hash de vérification :</strong> <code id="cert-hash" style="font-size:10px;color:var(--primary-light)">—</code></div>
          <div>✅ <strong>Vérifié par :</strong> GeoTouba SIG Platform v2.0</div>
          <div style="margin-top:6px;font-size:9px;color:rgba(148,163,184,.5)">
            Ville de Touba, Sénégal — Gestion des Déchets Organiques
          </div>
        </div>
        <canvas id="cert-qr-canvas" width="80" height="80"></canvas>
      </div>

      <div class="cert-signature">✦ GEOTOUBA SIG · CERTIFICATION TRAÇABILITÉ DÉCHETS · SÉNÉGAL ✦</div>
    </div>

    <!-- Stats de cette session -->
    <div class="card" style="margin-top:16px">
      <div class="card-title"><i class="fas fa-chart-line"></i> Session courante</div>
      <div class="global-stats">
        <div class="g-stat">
          <div class="g-stat-val" id="sess-count">0</div>
          <div class="g-stat-lbl">Certificats générés</div>
        </div>
        <div class="g-stat">
          <div class="g-stat-val" id="sess-qty">0 kg</div>
          <div class="g-stat-lbl">Total collecté</div>
        </div>
        <div class="g-stat">
          <div class="g-stat-val" id="sess-co2">0</div>
          <div class="g-stat-lbl">kg CO₂ évité</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Historique -->
  <div class="card" style="margin-top:20px" id="hist-card">
    <div class="card-title"><i class="fas fa-history"></i> Historique de session</div>
    <div id="historique-list">
      <div style="text-align:center;color:var(--muted);padding:24px;font-size:13px">
        <i class="fas fa-clock" style="font-size:24px;margin-bottom:8px;display:block;opacity:.3"></i>
        Aucun certificat dans cette session
      </div>
    </div>
  </div>

</div>
</main>

<script>
// ─── FACTEURS CO2 (miroir du backend) ────────────────────────────────────────
const CO2_FACTORS = {
  dechets_alimentaires:   { facteur:600,  label:'Déchets alimentaires',          methode:'Compostage vs enfouissement (CH₄ évité)' },
  residus_vegetaux:       { facteur:450,  label:'Résidus végétaux / verts',      methode:'Compostage vs incinération à ciel ouvert' },
  fumier_animal:          { facteur:800,  label:'Fumier / lisier animal',         methode:'Biogaz (CH₄ capté) vs dégradation libre' },
  huiles_graisses:        { facteur:900,  label:'Huiles et graisses alimentaires',methode:'Biogaz vs décharge (ADEME 2023)' },
  residus_marche:         { facteur:520,  label:'Résidus de marché',              methode:'Compostage vs décharge ouverte' },
  boues_organiques:       { facteur:700,  label:'Boues organiques',               methode:'Valorisation vs lixiviat' },
  dechets_dahira:         { facteur:580,  label:'Déchets daharas / communautaires',methode:'Compostage collectif vs brûlage' },
  organique_mixte:        { facteur:550,  label:'Organique mixte',                methode:'Valorisation partielle moyenne ADEME' },
  dechets_verts:          { facteur:480,  label:'Déchets verts / jardins',        methode:'Compostage vs incinération' },
  dechets_maraichage:     { facteur:430,  label:'Résidus maraîchage',             methode:'Retour sol vs décharge' },
}

// Session stats
let sessionCount = 0, sessionQty = 0, sessionCO2 = 0
const sessionHist = []

// Init date d'aujourd'hui
document.getElementById('f-date').value = new Date().toISOString().slice(0,10)

// Charger les points de collecte
async function loadPoints() {
  try {
    const r = await axios.get('/api/points-collecte')
    const sel = document.getElementById('f-point')
    r.data.data.forEach(p => {
      const opt = document.createElement('option')
      opt.value = p.id
      opt.textContent = \`\${p.nom} (\${p.quartier})\`
      opt.dataset.quartier = p.quartier
      sel.appendChild(opt)
    })
  } catch(e) { console.warn(e) }
}
loadPoints()

// Auto-remplissage quartier selon point sélectionné
document.getElementById('f-point').addEventListener('change', function() {
  const opt = this.options[this.selectedIndex]
  if (opt && opt.dataset.quartier) {
    const qSel = document.getElementById('f-quartier')
    for (let i = 0; i < qSel.options.length; i++) {
      if (qSel.options[i].text === opt.dataset.quartier) {
        qSel.selectedIndex = i; break
      }
    }
  }
})

// Slider synchronisation
function updateQty(val) {
  document.getElementById('f-qty').value = val
  updateSliderStyle(val)
  updatePreview()
}
function syncSlider(val) {
  const n = parseFloat(val) || 0
  const max = document.getElementById('f-qty-slider').max
  document.getElementById('f-qty-slider').value = Math.min(n, max)
  updateSliderStyle(Math.min(n, max))
}
function updateSliderStyle(val) {
  const sl = document.getElementById('f-qty-slider')
  const pct = (val - sl.min) / (sl.max - sl.min) * 100
  sl.style.setProperty('--pct', pct + '%')
  document.getElementById('qty-display').textContent = parseFloat(val).toLocaleString('fr-FR')
  const unite = document.getElementById('f-unite').value
  document.getElementById('qty-unit').textContent = unite === 'tonnes' ? 'tonnes (t)' : 'kilogrammes (kg)'
}

// Preview CO2
function updatePreview() {
  const type = document.getElementById('f-type').value
  const qty  = parseFloat(document.getElementById('f-qty').value) || 0
  const unite= document.getElementById('f-unite').value
  const qtyKg= unite === 'tonnes' ? qty * 1000 : qty

  document.getElementById('qty-display').textContent = qty.toLocaleString('fr-FR')

  if (!type || !qty) {
    document.getElementById('co2-preview-block').style.display = 'none'; return
  }
  const cfg = CO2_FACTORS[type] || CO2_FACTORS.organique_mixte
  const co2  = Math.round(cfg.facteur * (qtyKg/1000) * 100) / 100
  const arb  = Math.round(co2 / 21.77 * 10) / 10
  const km   = Math.round(co2 / 0.21)

  document.getElementById('co2-preview-block').style.display = 'block'
  document.getElementById('co2-val').textContent     = co2.toLocaleString('fr-FR')
  document.getElementById('co2-arbres').textContent  = arb.toLocaleString('fr-FR')
  document.getElementById('co2-km').textContent      = km.toLocaleString('fr-FR')
  document.getElementById('co2-methode').textContent = cfg.methode
}

// ─── GÉNÉRATION ────────────────────────────────────────────────────────────────
async function genererCertificat() {
  const type = document.getElementById('f-type').value
  const qty  = parseFloat(document.getElementById('f-qty').value)
  if (!type) { alert('Veuillez sélectionner un type de déchet'); return }
  if (!qty || qty <= 0) { alert('Veuillez saisir une quantité valide'); return }

  const pointSel = document.getElementById('f-point')
  const pointOpt = pointSel.options[pointSel.selectedIndex]

  const payload = {
    type_dechet:        type,
    quantite_kg:        document.getElementById('f-unite').value === 'tonnes' ? qty * 1000 : qty,
    unite:              document.getElementById('f-unite').value,
    point_collecte_id:  pointSel.value || null,
    point_collecte_nom: pointOpt && pointSel.value ? pointOpt.text : 'Non spécifié',
    quartier:           document.getElementById('f-quartier').value,
    operateur:          document.getElementById('f-operateur').value || 'Agent GeoTouba',
    destination:        document.getElementById('f-destination').value,
    date_collecte:      document.getElementById('f-date').value,
    notes_agent:        document.getElementById('f-notes').value,
  }

  try {
    const btn = document.querySelector('.btn-primary')
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération…'; btn.disabled = true

    const resp = await axios.post('/api/certificat/generer', payload)
    const cert = resp.data.data

    afficherCertificat(cert)

    // Stats session
    sessionCount++; sessionQty += cert.quantite_kg; sessionCO2 += cert.co2_evite_kg
    updateSessionStats()
    addToHistory(cert)

    btn.innerHTML = '<i class="fas fa-certificate"></i> Générer le certificat officiel'; btn.disabled = false
  } catch(e) {
    alert('Erreur lors de la génération : ' + (e.response?.data?.message || e.message))
    document.querySelector('.btn-primary').innerHTML = '<i class="fas fa-certificate"></i> Générer le certificat officiel'
    document.querySelector('.btn-primary').disabled = false
  }
}

function afficherCertificat(cert) {
  // Remplissage
  document.getElementById('cert-numero').textContent        = 'N° ' + cert.numero
  document.getElementById('cert-type-label').textContent   = cert.type_dechet_label
  document.getElementById('cert-quantite').textContent     = cert.quantite_kg.toLocaleString('fr-FR') + ' kg'
  document.getElementById('cert-point').textContent        = cert.point_collecte_nom
  document.getElementById('cert-quartier').textContent     = cert.quartier + ', ' + cert.ville
  document.getElementById('cert-destination').textContent  = cert.destination
  document.getElementById('cert-operateur').textContent    = cert.operateur
  document.getElementById('cert-date-collecte').textContent= new Date(cert.date_collecte).toLocaleDateString('fr-FR', {weekday:'long',year:'numeric',month:'long',day:'numeric'})
  document.getElementById('cert-co2').textContent          = cert.co2_evite_kg.toLocaleString('fr-FR') + ' kg CO₂eq'
  document.getElementById('cert-arbres').textContent       = cert.equivalences.arbres_1_an.toLocaleString('fr-FR')
  document.getElementById('cert-km').textContent           = cert.equivalences.km_voiture.toLocaleString('fr-FR')
  document.getElementById('cert-foyers').textContent       = cert.equivalences.foyers_electricite_jours.toLocaleString('fr-FR')
  document.getElementById('cert-methode').textContent      = cert.methode_calcul
  document.getElementById('cert-notes').textContent        = cert.notes_agent || 'Aucune'
  document.getElementById('cert-date-emission').textContent= new Date(cert.date_emission).toLocaleString('fr-FR')
  document.getElementById('cert-hash').textContent         = cert.hash

  // QR code — URL de vérification
  const qrData = \`https://geotouba.pages.dev/api/certificat/verifier/\${cert.numero}\`
  QRCode.toCanvas(document.getElementById('cert-qr-canvas'), qrData, { width:80, margin:1 }, () => {})

  // Afficher/masquer
  document.getElementById('cert-placeholder').style.display = 'none'
  document.getElementById('certificat-container').style.display = 'block'

  // Scroll
  document.getElementById('certificat-container').scrollIntoView({ behavior:'smooth', block:'start' })
}

function updateSessionStats() {
  document.getElementById('sess-count').textContent = sessionCount
  document.getElementById('sess-qty').textContent   = sessionQty.toLocaleString('fr-FR') + ' kg'
  document.getElementById('sess-co2').textContent   = Math.round(sessionCO2).toLocaleString('fr-FR')
}

function addToHistory(cert) {
  sessionHist.unshift(cert)
  const list = document.getElementById('historique-list')
  const icons = {
    dechets_alimentaires:'🍽️', residus_vegetaux:'🌿', fumier_animal:'🐄',
    huiles_graisses:'🫙', residus_marche:'🛒', boues_organiques:'💧',
    dechets_dahira:'🕌', organique_mixte:'♻️', dechets_verts:'🌱', dechets_maraichage:'🥬'
  }
  const icon = icons[cert.type_dechet] || '♻️'
  const item = document.createElement('div')
  item.className = 'hist-item'
  item.onclick = () => afficherCertificat(cert)
  item.innerHTML = \`
    <div class="hist-icon">\${icon}</div>
    <div style="flex:1;min-width:0">
      <div class="hist-num">\${cert.numero}</div>
      <div class="hist-type">\${cert.type_dechet_label}</div>
      <div class="hist-meta">\${cert.quantite_kg.toLocaleString('fr-FR')} kg · \${cert.quartier} · \${cert.operateur}</div>
    </div>
    <div class="hist-co2">
      <div class="hist-co2-val">\${cert.co2_evite_kg} kg</div>
      <div class="hist-co2-lbl">CO₂ évité</div>
    </div>\`

  if (list.querySelector('.fa-clock')) list.innerHTML = ''
  list.insertBefore(item, list.firstChild)
}

function resetCertificat() {
  document.getElementById('cert-placeholder').style.display = 'block'
  document.getElementById('certificat-container').style.display = 'none'
  document.getElementById('f-type').value = ''
  document.getElementById('f-qty').value = '100'
  document.getElementById('f-qty-slider').value = 100
  document.getElementById('f-notes').value = ''
  document.getElementById('co2-preview-block').style.display = 'none'
  updateSliderStyle(100)
}

// Téléchargement PDF via print dialog
function telechargerCertificat() {
  window.print()
}

// ─── VÉRIFICATION ─────────────────────────────────────────────────────────────
async function verifierCertificat() {
  const num = document.getElementById('verif-num').value.trim()
  if (!num) { alert('Saisissez un numéro de certificat'); return }
  try {
    const r = await axios.get(\`/api/certificat/verifier/\${encodeURIComponent(num)}\`)
    const d = r.data.data
    const el = document.getElementById('verif-result')
    el.style.display = 'block'
    if (d.statut === 'valide') {
      el.style.background = 'rgba(22,163,74,.12)'
      el.style.border = '1px solid rgba(22,163,74,.4)'
      el.innerHTML = \`<i class="fas fa-check-circle" style="color:#22c55e"></i> <strong style="color:#22c55e">Certificat VALIDE</strong><br>
        <span style="font-size:11px;color:#94a3b8">\${d.message}<br>Vérifié le : \${new Date(d.date_verification).toLocaleString('fr-FR')}</span>\`
    } else {
      el.style.background = 'rgba(239,68,68,.12)'
      el.style.border = '1px solid rgba(239,68,68,.4)'
      el.innerHTML = \`<i class="fas fa-times-circle" style="color:#ef4444"></i> <strong style="color:#ef4444">Certificat INVALIDE</strong><br>
        <span style="font-size:11px;color:#94a3b8">\${d.message}</span>\`
    }
  } catch(e) { alert('Erreur de vérification') }
}

// Init
updateSliderStyle(100)
</script>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════════════════
// PWA MANIFEST
// ═══════════════════════════════════════════════════════════════════════════
function getPwaManifest() {
  return {
    name: 'GeoTouba Agent — Collecte Déchets',
    short_name: 'GeoTouba',
    description: "Application mobile pour agents de collecte — Ville de Touba",
    start_url: '/agent',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#16a34a',
    orientation: 'portrait',
    lang: 'fr',
    icons: [
      { src: '/static/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
    ],
    categories: ['utilities', 'productivity'],
    shortcuts: [
      { name: 'Scanner un bac', url: '/agent#scanner', description: 'Mettre à jour un bac' },
      { name: 'Signaler problème', url: '/agent#signalement', description: 'Signaler un problème' },
      { name: 'Alertes', url: '/alertes', description: 'Voir les alertes actives' }
    ]
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE WORKER JS
// ═══════════════════════════════════════════════════════════════════════════
function getServiceWorkerJs(): string {
  return `
const CACHE_NAME = 'geotouba-v1';
const OFFLINE_URL = '/agent';
const CACHED_URLS = [
  '/agent',
  '/alertes',
  '/export',
  '/api/points-collecte',
  '/api/stats',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHED_URLS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match(OFFLINE_URL)))
  );
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'GeoTouba — Alerte';
  const options = {
    body: data.body || 'Nouveau message',
    icon: '/static/favicon.svg',
    badge: '/static/favicon.svg',
    vibrate: [200, 100, 200],
    data: data,
    actions: [
      { action: 'voir', title: 'Voir sur la carte' },
      { action: 'fermer', title: 'Fermer' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'voir') {
    event.waitUntil(clients.openWindow('/alertes'));
  }
});
`.trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE AGENT PWA (MOBILE)
// ═══════════════════════════════════════════════════════════════════════════
function getAgentPwaHtml(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="GeoTouba Agent">
  <meta name="theme-color" content="#16a34a">
  <title>GeoTouba Agent — Terrain</title>
  <link rel="manifest" href="/manifest.json">
  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #16a34a; --primary-dark: #15803d;
      --danger: #ef4444; --warning: #f59e0b;
      --dark: #0f172a; --card: #1e293b;
      --border: #334155; --text: #e2e8f0; --muted: #64748b;
      --radius: 14px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    html, body { height: 100%; background: var(--dark); color: var(--text); font-family: 'Inter', sans-serif; overscroll-behavior: none; }

    /* ── TOP BAR ── */
    #topbar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 100;
      background: linear-gradient(135deg, #0f172a, #1a2e1a);
      padding: env(safe-area-inset-top, 12px) 16px 12px;
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px solid var(--border);
    }
    .topbar-brand { display: flex; align-items: center; gap: 10px; }
    .topbar-logo { width: 36px; height: 36px; background: var(--primary); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
    .topbar-title { font-size: 15px; font-weight: 700; color: #fff; }
    .topbar-sub { font-size: 11px; color: var(--muted); }
    .topbar-sync { background: none; border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 8px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 5px; }
    .topbar-sync.syncing i { animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    /* ── SCROLL AREA ── */
    #main { padding-top: 72px; padding-bottom: 80px; overflow-y: auto; height: 100vh; }

    /* ── STATUS BAR ── */
    #status-bar {
      margin: 12px 16px; background: var(--card); border-radius: var(--radius);
      padding: 12px 16px; border: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
    }
    .status-dot-live { width: 8px; height: 8px; background: var(--primary); border-radius: 50%; animation: pulse 2s infinite; margin-right: 6px; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
    .status-info { display: flex; align-items: center; font-size: 12px; font-weight: 600; color: var(--primary); }
    .status-right { font-size: 10px; color: var(--muted); }
    #offline-banner { background: #7c2d12; color: #fed7aa; padding: 8px 16px; text-align: center; font-size: 12px; font-weight: 600; display: none; }
    #offline-banner.visible { display: block; }

    /* ── SECTION TITLE ── */
    .section-title { padding: 16px 16px 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
    .section-title::before { content: ''; width: 3px; height: 12px; background: var(--primary); border-radius: 2px; }

    /* ── QUICK ACTIONS ── */
    .quick-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 0 16px; }
    .action-card {
      background: var(--card); border-radius: var(--radius); padding: 16px;
      border: 1px solid var(--border); cursor: pointer; transition: all 0.2s;
      display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center;
      active: background: #243548;
    }
    .action-card:active { transform: scale(0.97); background: #243548; }
    .action-card.danger { border-color: rgba(239,68,68,.4); }
    .action-card.primary { border-color: rgba(22,163,74,.4); }
    .action-card.warning { border-color: rgba(245,158,11,.4); }
    .action-card.info { border-color: rgba(8,145,178,.4); }
    .action-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 22px; }
    .action-icon.green { background: rgba(22,163,74,.2); }
    .action-icon.red { background: rgba(239,68,68,.2); }
    .action-icon.orange { background: rgba(245,158,11,.2); }
    .action-icon.blue { background: rgba(8,145,178,.2); }
    .action-label { font-size: 12px; font-weight: 600; color: var(--text); }
    .action-sub { font-size: 10px; color: var(--muted); }

    /* ── ALERT CARDS ── */
    .alert-cards { padding: 0 16px; display: flex; flex-direction: column; gap: 8px; }
    .alert-card {
      background: var(--card); border-radius: var(--radius); padding: 14px;
      border-left: 4px solid var(--danger); cursor: pointer; transition: all 0.2s;
    }
    .alert-card.warning { border-left-color: var(--warning); }
    .alert-card:active { transform: scale(0.99); }
    .alert-card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
    .alert-card-name { font-size: 13px; font-weight: 700; color: #fff; }
    .alert-badge { padding: 3px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; }
    .badge-critical { background: rgba(239,68,68,.2); color: var(--danger); }
    .badge-warning { background: rgba(245,158,11,.2); color: var(--warning); }
    .alert-card-fill { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
    .fill-pct { font-size: 20px; font-weight: 800; color: var(--danger); width: 56px; flex-shrink: 0; }
    .fill-pct.warning-pct { color: var(--warning); }
    .fill-track2 { flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
    .fill-bar2 { height: 100%; border-radius: 4px; background: var(--danger); }
    .fill-bar2.warning-bar { background: var(--warning); }
    .alert-card-meta { font-size: 11px; color: var(--muted); display: flex; gap: 12px; }

    /* ── MODAL OVERLAY ── */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.8); z-index: 200;
      display: flex; align-items: flex-end; opacity: 0; pointer-events: none; transition: opacity 0.3s;
    }
    .modal-overlay.open { opacity: 1; pointer-events: all; }
    .modal-sheet {
      background: #1a2535; width: 100%; border-radius: 20px 20px 0 0;
      padding: 20px; padding-bottom: calc(env(safe-area-inset-bottom, 20px) + 20px);
      transform: translateY(100%); transition: transform 0.35s cubic-bezier(.4,0,.2,1);
      max-height: 90vh; overflow-y: auto;
    }
    .modal-overlay.open .modal-sheet { transform: translateY(0); }
    .modal-handle { width: 40px; height: 4px; background: var(--border); border-radius: 2px; margin: 0 auto 16px; }
    .modal-title { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }

    /* ── FORMS ── */
    .form-group { margin-bottom: 14px; }
    .form-label { font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 6px; display: block; text-transform: uppercase; letter-spacing: .5px; }
    .form-input, .form-select, .form-textarea {
      width: 100%; background: var(--dark); border: 1px solid var(--border);
      color: var(--text); padding: 12px 14px; border-radius: 10px;
      font-size: 14px; font-family: inherit;
    }
    .form-input:focus, .form-select:focus, .form-textarea:focus { outline: none; border-color: var(--primary); }
    .form-textarea { min-height: 80px; resize: none; }
    .slider-row { display: flex; align-items: center; gap: 12px; }
    .fill-slider {
      flex: 1; -webkit-appearance: none; height: 8px; border-radius: 4px;
      background: linear-gradient(to right, #16a34a var(--val, 50%), var(--border) var(--val, 50%));
      outline: none;
    }
    .fill-slider::-webkit-slider-thumb {
      -webkit-appearance: none; width: 22px; height: 22px; border-radius: 50%;
      background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.4); cursor: pointer;
    }
    .slider-val { font-size: 22px; font-weight: 800; width: 56px; text-align: center; }

    /* ── BUTTONS ── */
    .btn { width: 100%; padding: 14px; border-radius: 12px; border: none; font-size: 15px; font-weight: 700; cursor: pointer; font-family: inherit; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all .2s; }
    .btn:active { transform: scale(0.98); }
    .btn-green { background: var(--primary); color: #fff; }
    .btn-green:hover { background: var(--primary-dark); }
    .btn-red { background: var(--danger); color: #fff; }
    .btn-ghost { background: var(--border); color: var(--text); margin-top: 8px; }

    /* ── POINTS LIST ── */
    .points-scroll { padding: 0 16px; display: flex; flex-direction: column; gap: 8px; }
    .point-row {
      background: var(--card); border-radius: var(--radius); padding: 12px 14px;
      border: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; gap: 12px;
      transition: all .2s;
    }
    .point-row:active { background: #243548; }
    .point-row-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
    .point-row-info { flex: 1; min-width: 0; }
    .point-row-name { font-size: 13px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .point-row-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .point-row-fill { font-size: 13px; font-weight: 800; flex-shrink: 0; }

    /* ── BOTTOM NAV ── */
    #bottom-nav {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
      background: var(--dark); border-top: 1px solid var(--border);
      padding: 8px 0 calc(env(safe-area-inset-bottom, 8px) + 8px);
      display: flex;
    }
    .nav-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 4px; cursor: pointer; transition: all .2s; border: none; background: none; color: var(--muted); font-family: inherit; }
    .nav-item.active { color: var(--primary); }
    .nav-item i { font-size: 18px; }
    .nav-item span { font-size: 10px; font-weight: 600; }
    .nav-badge { position: absolute; top: -4px; right: 4px; background: var(--danger); color: #fff; border-radius: 8px; font-size: 9px; padding: 1px 5px; font-weight: 700; }

    /* ── SUCCESS TOAST ── */
    #toast {
      position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%) translateY(20px);
      background: #064e3b; color: #6ee7b7; border: 1px solid #10b981;
      padding: 12px 20px; border-radius: 12px; font-size: 13px; font-weight: 600;
      z-index: 300; opacity: 0; transition: all .3s; white-space: nowrap;
    }
    #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

    /* ── TABS ── */
    .tab-bar { display: flex; background: var(--card); border-radius: 10px; margin: 0 16px 16px; padding: 3px; }
    .tab-btn { flex: 1; padding: 8px; border: none; background: none; color: var(--muted); font-size: 12px; font-weight: 600; border-radius: 8px; cursor: pointer; font-family: inherit; transition: all .2s; }
    .tab-btn.active { background: var(--primary); color: #fff; }

    /* ── INSTALL BANNER ── */
    #install-banner { display: none; background: #1e3a2f; border: 1px solid var(--primary); margin: 8px 16px; border-radius: var(--radius); padding: 12px 14px; align-items: center; gap: 10px; }
    #install-banner.visible { display: flex; }
    .install-text { flex: 1; font-size: 12px; color: var(--text); }
    .install-btn { background: var(--primary); color: #fff; border: none; padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .install-close { background: none; border: none; color: var(--muted); font-size: 16px; cursor: pointer; padding: 0 4px; }
  </style>
</head>
<body>

<!-- TOP BAR -->
<header id="topbar">
  <div class="topbar-brand">
    <div class="topbar-logo">🗑️</div>
    <div>
      <div class="topbar-title">GeoTouba Agent</div>
      <div class="topbar-sub" id="agent-name-display">Chargement...</div>
    </div>
  </div>
  <button class="topbar-sync" id="sync-btn" onclick="syncData()">
    <i class="fas fa-sync-alt"></i> Sync
  </button>
</header>

<div id="offline-banner">📡 Mode hors-ligne — données en cache</div>

<!-- INSTALL PWA BANNER -->
<div id="install-banner">
  <div class="install-text">📱 Installer sur l'écran d'accueil pour accès hors-ligne</div>
  <button class="install-btn" onclick="installPwa()">Installer</button>
  <button class="install-close" onclick="document.getElementById('install-banner').classList.remove('visible')">&times;</button>
</div>

<!-- MAIN SCROLL -->
<div id="main">

  <!-- Status Bar -->
  <div id="status-bar">
    <div class="status-info"><div class="status-dot-live"></div><span id="status-text">Synchronisé</span></div>
    <div class="status-right" id="status-time">—</div>
  </div>

  <!-- TAB CONTENT -->
  <div id="tab-dashboard">
    <!-- Quick Actions -->
    <div class="section-title"><i class="fas fa-bolt"></i> Actions rapides</div>
    <div class="quick-actions">
      <div class="action-card primary" onclick="openModal('modal-update')">
        <div class="action-icon green"><i class="fas fa-edit" style="color:#16a34a"></i></div>
        <div class="action-label">Mettre à jour</div>
        <div class="action-sub">Taux remplissage</div>
      </div>
      <div class="action-card danger" onclick="openModal('modal-signalement')">
        <div class="action-icon red"><i class="fas fa-exclamation-triangle" style="color:#ef4444"></i></div>
        <div class="action-label">Signaler</div>
        <div class="action-sub">Problème terrain</div>
      </div>
      <div class="action-card warning" onclick="openModal('modal-collecte')">
        <div class="action-icon orange"><i class="fas fa-truck" style="color:#f59e0b"></i></div>
        <div class="action-label">Collecte</div>
        <div class="action-sub">Confirmer passage</div>
      </div>
      <div class="action-card info" onclick="getCurrentLocation()">
        <div class="action-icon blue"><i class="fas fa-map-marker-alt" style="color:#0891b2"></i></div>
        <div class="action-label">Ma position</div>
        <div class="action-sub">GPS terrain</div>
      </div>
    </div>

    <!-- Alertes actives -->
    <div class="section-title"><i class="fas fa-bell"></i> Alertes actives <span id="alert-count-badge" style="background:#ef4444;color:#fff;border-radius:10px;padding:1px 8px;font-size:10px;margin-left:4px">0</span></div>
    <div class="alert-cards" id="alert-list">
      <div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">
        <i class="fas fa-spinner fa-spin"></i> Chargement...
      </div>
    </div>
  </div>

  <div id="tab-points" style="display:none">
    <div style="padding:12px 16px">
      <input type="text" id="search-points" placeholder="🔍 Rechercher un point..." oninput="filterPoints()" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:10px 14px;border-radius:10px;font-size:14px;font-family:inherit;outline:none">
    </div>
    <div class="points-scroll" id="points-list-mobile"></div>
  </div>

  <div id="tab-profil" style="display:none">
    <div style="padding:16px">
      <div style="background:#1e293b;border-radius:14px;padding:20px;text-align:center;margin-bottom:16px;border:1px solid #334155">
        <div style="width:70px;height:70px;background:#16a34a;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;margin:0 auto 12px">👷</div>
        <div id="agent-full-name" style="font-size:18px;font-weight:700;color:#fff">—</div>
        <div id="agent-role-display" style="font-size:12px;color:#64748b;margin-top:4px">Agent de collecte</div>
      </div>
      <div style="background:#1e293b;border-radius:14px;padding:16px;border:1px solid #334155;margin-bottom:12px">
        <div class="form-group">
          <label class="form-label">Votre nom complet</label>
          <input class="form-input" id="profil-nom" placeholder="Ex: Moussa Diallo" value="">
        </div>
        <div class="form-group">
          <label class="form-label">Téléphone</label>
          <input class="form-input" id="profil-tel" type="tel" placeholder="+221 77 XXX XXXX">
        </div>
        <div class="form-group">
          <label class="form-label">Zone d'intervention</label>
          <select class="form-select" id="profil-zone">
            <optgroup label="── Quartiers historiques ──">
              <option>Darou Khoudoss</option>
              <option>Gouye Mbind</option>
              <option>Darou Miname</option>
              <option>Touba Guédé</option>
              <option>Touba Mosquée</option>
              <option>Keur Niang</option>
              <option>Khaira</option>
              <option>Guédé Bousso</option>
              <option>Samer</option>
              <option>Darou Marnane</option>
              <option>Ndame</option>
              <option>Madiyana</option>
              <option>Dianatoul Mahwa</option>
            </optgroup>
            <optgroup label="── Villages urbains ──">
              <option>Alia</option>
              <option>Arifina</option>
              <option>Boukhatoul Moubarak</option>
              <option>Boustanoul</option>
              <option>Darou Alimoul Khabir</option>
              <option>Darou Khadim</option>
              <option>Darou Marnane 2</option>
              <option>Darou Salam Ndame</option>
              <option>Ndindy Abdou</option>
              <option>Ndamatou 1</option>
              <option>Route de Darou Mousty</option>
              <option>Same Lah</option>
              <option>Touba Al Azhar</option>
              <option>Touba HLM</option>
            </optgroup>
            <optgroup label="── Zones périphériques ──">
              <option>Touba Bagdad</option>
              <option>Mbacké Bâri</option>
              <option>Touba Wadane</option>
              <option>Diakhaye</option>
              <option>NDindy</option>
              <option>Taif</option>
              <option>Touba Ndiarème</option>
              <option>Bélel</option>
              <option>Sourah</option>
              <option>Mbal</option>
              <option>Loyène</option>
              <option>Kenya</option>
              <option>Djibock</option>
              <option>Lyndiane</option>
              <option>Diabir</option>
            </optgroup>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Notifications SMS/Email</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
              <input type="checkbox" id="notif-sms" checked style="accent-color:#16a34a"> SMS
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
              <input type="checkbox" id="notif-email" style="accent-color:#16a34a"> Email
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
              <input type="checkbox" id="notif-push" checked style="accent-color:#16a34a"> Push
            </label>
          </div>
        </div>
        <button class="btn btn-green" onclick="saveProfil()"><i class="fas fa-save"></i> Enregistrer le profil</button>
      </div>

      <!-- Stats agent -->
      <div style="background:#1e293b;border-radius:14px;padding:16px;border:1px solid #334155">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:12px">Ma session aujourd'hui</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;text-align:center">
          <div><div id="stat-updates" style="font-size:24px;font-weight:800;color:#16a34a">0</div><div style="font-size:10px;color:#64748b">Mises à jour</div></div>
          <div><div id="stat-signalements" style="font-size:24px;font-weight:800;color:#f59e0b">0</div><div style="font-size:10px;color:#64748b">Signalements</div></div>
          <div><div id="stat-collectes" style="font-size:24px;font-weight:800;color:#0891b2">0</div><div style="font-size:10px;color:#64748b">Collectes</div></div>
        </div>
      </div>

      <div style="margin-top:12px;text-align:center">
        <a href="/" style="color:#64748b;font-size:12px;text-decoration:none"><i class="fas fa-map"></i> Retour au portail cartographique</a>
      </div>
    </div>
  </div>

</div>

<!-- BOTTOM NAV -->
<nav id="bottom-nav">
  <button class="nav-item active" id="nav-dashboard" onclick="showTab('dashboard')">
    <i class="fas fa-th-large"></i><span>Tableau</span>
  </button>
  <button class="nav-item" id="nav-points" onclick="showTab('points')">
    <i class="fas fa-map-marker-alt"></i><span>Points</span>
  </button>
  <button class="nav-item" id="nav-profil" onclick="showTab('profil')">
    <i class="fas fa-user"></i><span>Profil</span>
  </button>
</nav>

<!-- TOAST -->
<div id="toast"></div>

<!-- ═══ MODAL: MISE À JOUR ═══ -->
<div class="modal-overlay" id="modal-update" onclick="closeModalOnBg(event,'modal-update')">
  <div class="modal-sheet">
    <div class="modal-handle"></div>
    <div class="modal-title"><span style="background:#dcfce7;padding:6px;border-radius:8px">♻️</span> Mettre à jour un bac</div>
    <div class="form-group">
      <label class="form-label">Point de collecte</label>
      <select class="form-select" id="update-point-id">
        <option value="">Sélectionner...</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Taux de remplissage</label>
      <div class="slider-row">
        <input type="range" class="fill-slider" id="fill-slider" min="0" max="100" value="50"
          oninput="updateSlider(this)">
        <div class="slider-val" id="slider-val" style="color:#16a34a">50%</div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:4px">
        <span>Vide</span><span>Mi-plein</span><span>Plein</span>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Observation (optionnel)</label>
      <textarea class="form-textarea" id="update-notes" placeholder="Ex: Odeur forte, débordement partiel..."></textarea>
    </div>
    <button class="btn btn-green" onclick="submitUpdate()"><i class="fas fa-check"></i> Envoyer la mise à jour</button>
    <button class="btn btn-ghost" onclick="closeModal('modal-update')">Annuler</button>
  </div>
</div>

<!-- ═══ MODAL: SIGNALEMENT ═══ -->
<div class="modal-overlay" id="modal-signalement" onclick="closeModalOnBg(event,'modal-signalement')">
  <div class="modal-sheet">
    <div class="modal-handle"></div>
    <div class="modal-title"><span style="background:#fee2e2;padding:6px;border-radius:8px">⚠️</span> Signaler un problème</div>
    <div class="form-group">
      <label class="form-label">Point concerné</label>
      <select class="form-select" id="signal-point-id">
        <option value="">Sélectionner...</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Type de problème</label>
      <select class="form-select" id="signal-type">
        <option value="debordement">🚨 Débordement / Bac plein</option>
        <option value="degradation">🔧 Bac endommagé</option>
        <option value="incendie">🔥 Incendie / Fumée</option>
        <option value="odeur">💨 Odeur extrême</option>
        <option value="acces">🚧 Accès bloqué</option>
        <option value="vandalisme">🏚️ Vandalisme</option>
        <option value="autre">📋 Autre</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Priorité</label>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <label style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px;text-align:center;cursor:pointer;font-size:12px">
          <input type="radio" name="priorite" value="normale" checked style="display:none"> 🟡 Normale
        </label>
        <label style="background:#1e293b;border:1px solid #f97316;border-radius:8px;padding:8px;text-align:center;cursor:pointer;font-size:12px">
          <input type="radio" name="priorite" value="urgente" style="display:none"> 🟠 Urgente
        </label>
        <label style="background:#1e293b;border:1px solid #ef4444;border-radius:8px;padding:8px;text-align:center;cursor:pointer;font-size:12px">
          <input type="radio" name="priorite" value="critique" style="display:none"> 🔴 Critique
        </label>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <textarea class="form-textarea" id="signal-desc" placeholder="Décrivez le problème en détail..."></textarea>
    </div>
    <button class="btn btn-red" onclick="submitSignalement()"><i class="fas fa-paper-plane"></i> Envoyer le signalement</button>
    <button class="btn btn-ghost" onclick="closeModal('modal-signalement')">Annuler</button>
  </div>
</div>

<!-- ═══ MODAL: COLLECTE ═══ -->
<div class="modal-overlay" id="modal-collecte" onclick="closeModalOnBg(event,'modal-collecte')">
  <div class="modal-sheet">
    <div class="modal-handle"></div>
    <div class="modal-title"><span style="background:#fef3c7;padding:6px;border-radius:8px">🚛</span> Confirmer une collecte</div>
    <div class="form-group">
      <label class="form-label">Point collecté</label>
      <select class="form-select" id="collecte-point-id">
        <option value="">Sélectionner...</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Volume collecté (m³ estimé)</label>
      <input class="form-input" type="number" id="collecte-volume" placeholder="Ex: 4.5" step="0.5" min="0" max="50">
    </div>
    <div class="form-group">
      <label class="form-label">Qualité des déchets</label>
      <select class="form-select" id="collecte-qualite">
        <option value="normal">✅ Normal — principalement organique</option>
        <option value="melange">⚠️ Mélangé — tri incomplet</option>
        <option value="contamine">❌ Contaminé — corps étrangers</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Destination</label>
      <select class="form-select" id="collecte-destination">
        <option value="compostage">🌱 Plateforme compostage Keur Niang</option>
        <option value="biogaz">⚡ Unité biogaz Route Mbacké</option>
        <option value="centre_tri">🔄 Centre de tri Darou Khoudoss</option>
        <option value="decharge">🗑️ Décharge contrôlée</option>
      </select>
    </div>
    <button class="btn btn-green" onclick="submitCollecte()"><i class="fas fa-truck"></i> Confirmer la collecte</button>
    <button class="btn btn-ghost" onclick="closeModal('modal-collecte')">Annuler</button>
  </div>
</div>

<!-- SCRIPTS -->
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script>
// ═══════════════════════════════════════════════════════════════════
// ÉTAT
// ═══════════════════════════════════════════════════════════════════
let allPointsMobile = []
let sessionStats = { updates: 0, signalements: 0, collectes: 0 }
let deferredInstallPrompt = null
let currentTab = 'dashboard'

// ═══════════════════════════════════════════════════════════════════
// SERVICE WORKER + PWA
// ═══════════════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(reg => console.log('[SW] Enregistré:', reg.scope))
    .catch(err => console.warn('[SW] Erreur:', err))
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredInstallPrompt = e
  document.getElementById('install-banner').classList.add('visible')
})

window.addEventListener('online', () => document.getElementById('offline-banner').classList.remove('visible'))
window.addEventListener('offline', () => document.getElementById('offline-banner').classList.add('visible'))
if (!navigator.onLine) document.getElementById('offline-banner').classList.add('visible')

function installPwa() {
  if (!deferredInstallPrompt) return
  deferredInstallPrompt.prompt()
  deferredInstallPrompt.userChoice.then(res => {
    if (res.outcome === 'accepted') showToast('✅ Application installée !')
    deferredInstallPrompt = null
    document.getElementById('install-banner').classList.remove('visible')
  })
}

// ═══════════════════════════════════════════════════════════════════
// PROFIL AGENT
// ═══════════════════════════════════════════════════════════════════
function loadProfil() {
  const nom = localStorage.getItem('agent_nom') || ''
  const tel = localStorage.getItem('agent_tel') || ''
  const zone = localStorage.getItem('agent_zone') || 'Centre Touba'
  document.getElementById('profil-nom').value = nom
  document.getElementById('profil-tel').value = tel
  document.getElementById('profil-zone').value = zone
  document.getElementById('agent-name-display').textContent = nom || 'Définir mon profil →'
  document.getElementById('agent-full-name').textContent = nom || 'Agent non configuré'
}

function saveProfil() {
  const nom = document.getElementById('profil-nom').value.trim()
  const tel = document.getElementById('profil-tel').value.trim()
  const zone = document.getElementById('profil-zone').value
  if (!nom) { showToast('⚠️ Entrez votre nom'); return }
  localStorage.setItem('agent_nom', nom)
  localStorage.setItem('agent_tel', tel)
  localStorage.setItem('agent_zone', zone)
  document.getElementById('agent-name-display').textContent = nom
  document.getElementById('agent-full-name').textContent = nom
  showToast('✅ Profil enregistré !')
}

// ═══════════════════════════════════════════════════════════════════
// CHARGEMENT DONNÉES
// ═══════════════════════════════════════════════════════════════════
async function loadData() {
  try {
    const [pointsResp, alertesResp] = await Promise.all([
      axios.get('/api/points-collecte'),
      axios.get('/api/alertes')
    ])
    allPointsMobile = pointsResp.data.data
    renderAlerts(alertesResp.data.data)
    renderPointsList(allPointsMobile)
    populateSelects()
    document.getElementById('status-text').textContent = 'Synchronisé'
    document.getElementById('status-time').textContent = new Date().toLocaleTimeString('fr-FR')
  } catch (err) {
    document.getElementById('status-text').textContent = 'Hors-ligne'
  }
}

async function syncData() {
  const btn = document.getElementById('sync-btn')
  btn.classList.add('syncing')
  await loadData()
  btn.classList.remove('syncing')
  showToast('🔄 Données synchronisées')
}

function renderAlerts(alerts) {
  const el = document.getElementById('alert-list')
  document.getElementById('alert-count-badge').textContent = alerts.length
  if (!alerts.length) {
    el.innerHTML = '<div style="text-align:center;padding:20px;color:#16a34a;font-size:13px">✅ Aucune alerte active</div>'
    return
  }
  el.innerHTML = alerts.map(a => {
    const isCrit = a.niveau === 'critique'
    return \`
      <div class="alert-card \${isCrit ? '' : 'warning'}" onclick="openUpdateForPoint(\${a.id})">
        <div class="alert-card-header">
          <div class="alert-card-name">\${a.nom}</div>
          <span class="alert-badge \${isCrit ? 'badge-critical' : 'badge-warning'}">\${isCrit ? '🔴 CRITIQUE' : '🟡 ALERTE'}</span>
        </div>
        <div class="alert-card-fill">
          <div class="fill-pct \${isCrit ? '' : 'warning-pct'}">\${a.taux_remplissage}%</div>
          <div class="fill-track2"><div class="fill-bar2 \${isCrit ? '' : 'warning-bar'}" style="width:\${a.taux_remplissage}%"></div></div>
        </div>
        <div class="alert-card-meta">
          <span><i class="fas fa-map-marker-alt"></i> \${a.quartier}</span>
          <span><i class="fas fa-user"></i> \${a.responsable.split(' ').slice(0,2).join(' ')}</span>
        </div>
      </div>
    \`
  }).join('')
}

function renderPointsList(points) {
  const el = document.getElementById('points-list-mobile')
  const TYPE_MAP = { bac_ordures:'🗑️', point_apport_volontaire:'♻️', plateforme_compostage:'🌱', centre_tri:'🔄', unite_biogaz:'⚡' }
  const COLORS = { bac_ordures:'#16a34a', point_apport_volontaire:'#0891b2', plateforme_compostage:'#d97706', centre_tri:'#7c3aed', unite_biogaz:'#db2777' }
  el.innerHTML = points.map(p => {
    const fillColor = p.taux_remplissage >= 80 ? '#ef4444' : p.taux_remplissage >= 50 ? '#f59e0b' : '#16a34a'
    return \`
      <div class="point-row" onclick="openUpdateForPoint(\${p.id})">
        <div class="point-row-icon" style="background:\${COLORS[p.type] || '#64748b'}22">
          \${TYPE_MAP[p.type] || '📍'}
        </div>
        <div class="point-row-info">
          <div class="point-row-name">\${p.nom}</div>
          <div class="point-row-sub">\${p.quartier} · \${p.statut === 'actif' ? '✅ Actif' : '⚠️ Maintenance'}</div>
        </div>
        <div class="point-row-fill" style="color:\${fillColor}">\${p.statut === 'actif' ? p.taux_remplissage + '%' : '—'}</div>
      </div>
    \`
  }).join('')
}

function filterPoints() {
  const q = document.getElementById('search-points').value.toLowerCase()
  const filtered = allPointsMobile.filter(p =>
    p.nom.toLowerCase().includes(q) || p.quartier.toLowerCase().includes(q)
  )
  renderPointsList(filtered)
}

function populateSelects() {
  const selects = ['update-point-id', 'signal-point-id', 'collecte-point-id']
  const options = allPointsMobile.map(p =>
    \`<option value="\${p.id}">\${p.nom} — \${p.quartier}\${p.statut==='actif' ? ' (' + p.taux_remplissage + '%)' : ' ⚠️'}</option>\`
  ).join('')
  selects.forEach(id => {
    const el = document.getElementById(id)
    el.innerHTML = '<option value="">Sélectionner...</option>' + options
  })
}

// ═══════════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════════
function updateSlider(input) {
  const val = parseInt(input.value)
  const color = val >= 80 ? '#ef4444' : val >= 50 ? '#f59e0b' : '#16a34a'
  input.style.background = \`linear-gradient(to right, \${color} \${val}%, #334155 \${val}%)\`
  const sv = document.getElementById('slider-val')
  sv.textContent = val + '%'
  sv.style.color = color
}

function openUpdateForPoint(id) {
  document.getElementById('update-point-id').value = id
  openModal('modal-update')
}

async function submitUpdate() {
  const pointId = document.getElementById('update-point-id').value
  if (!pointId) { showToast('⚠️ Sélectionnez un point'); return }
  const taux = parseInt(document.getElementById('fill-slider').value)
  const notes = document.getElementById('update-notes').value
  const agentNom = localStorage.getItem('agent_nom') || 'Anonyme'
  try {
    const resp = await axios.post('/api/terrain/update', {
      point_id: parseInt(pointId), taux_remplissage: taux,
      notes_terrain: notes, agent_nom: agentNom
    })
    closeModal('modal-update')
    sessionStats.updates++
    document.getElementById('stat-updates').textContent = sessionStats.updates
    if (resp.data.data.alertes.length > 0) {
      showToast('🔴 ALERTE envoyée — bac critique !')
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('GeoTouba — Bac critique', { body: resp.data.data.alertes[0].message, icon: '/static/favicon.svg' })
      }
    } else {
      showToast('✅ Mise à jour enregistrée')
    }
    await loadData()
  } catch { showToast('❌ Erreur réseau — mode hors-ligne') }
}

async function submitSignalement() {
  const pointId = document.getElementById('signal-point-id').value
  if (!pointId) { showToast('⚠️ Sélectionnez un point'); return }
  const typeP = document.getElementById('signal-type').value
  const desc = document.getElementById('signal-desc').value
  const priorite = document.querySelector('input[name="priorite"]:checked')?.value || 'normale'
  try {
    await axios.post('/api/terrain/signalement', {
      point_id: parseInt(pointId), type_probleme: typeP,
      description: desc, priorite, agent_nom: localStorage.getItem('agent_nom') || 'Anonyme'
    })
    closeModal('modal-signalement')
    sessionStats.signalements++
    document.getElementById('stat-signalements').textContent = sessionStats.signalements
    showToast('📋 Signalement envoyé')
  } catch { showToast('❌ Erreur réseau') }
}

async function submitCollecte() {
  const pointId = document.getElementById('collecte-point-id').value
  if (!pointId) { showToast('⚠️ Sélectionnez un point'); return }
  const volume = document.getElementById('collecte-volume').value
  closeModal('modal-collecte')
  sessionStats.collectes++
  document.getElementById('stat-collectes').textContent = sessionStats.collectes
  showToast(\`🚛 Collecte confirmée — \${volume || '?'} m³\`)
  await loadData()
}

function getCurrentLocation() {
  if (!navigator.geolocation) { showToast('❌ GPS non disponible'); return }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords
      showToast(\`📍 \${latitude.toFixed(5)}, \${longitude.toFixed(5)} (±\${Math.round(accuracy)}m)\`)
    },
    () => showToast('❌ Position GPS indisponible')
  )
}

// Demander permission notifications
async function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    const perm = await Notification.requestPermission()
    if (perm === 'granted') showToast('🔔 Notifications activées')
  }
}

// ═══════════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════════
function showTab(tab) {
  currentTab = tab
  ;['dashboard','points','profil'].forEach(t => {
    document.getElementById(\`tab-\${t}\`).style.display = t === tab ? 'block' : 'none'
    document.getElementById(\`nav-\${t}\`).classList.toggle('active', t === tab)
  })
}

function openModal(id) {
  document.getElementById(id).classList.add('open')
  document.body.style.overflow = 'hidden'
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open')
  document.body.style.overflow = ''
}
function closeModalOnBg(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id)
}

let toastTimer = null
function showToast(msg) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000)
}

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════
loadProfil()
loadData()
requestNotifPermission()

// Rafraîchissement auto toutes les 2 minutes
setInterval(loadData, 2 * 60 * 1000)
</script>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE EXPORT QGIS
// ═══════════════════════════════════════════════════════════════════════════
function getExportHtml(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Export QGIS — GeoTouba</title>
  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root { --primary:#16a34a; --dark:#0f172a; --card:#1e293b; --border:#334155; --text:#e2e8f0; --muted:#64748b; }
    *{box-sizing:border-box;margin:0;padding:0} body{font-family:'Inter',sans-serif;background:var(--dark);color:var(--text);min-height:100vh}
    header{background:linear-gradient(135deg,#0f172a,#1e3a2f);padding:20px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px}
    .back-btn{background:var(--card);border:1px solid var(--border);color:var(--text);padding:8px 14px;border-radius:8px;font-size:13px;cursor:pointer;text-decoration:none;display:flex;align-items:center;gap:6px}
    h1{font-size:20px;font-weight:800;color:#fff} .sub{font-size:13px;color:var(--muted);margin-top:2px}
    main{max-width:960px;margin:0 auto;padding:24px}
    .section{margin-bottom:32px}
    .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-bottom:16px;display:flex;align-items:center;gap:8px}
    .section-title::before{content:'';width:3px;height:14px;background:var(--primary);border-radius:2px}
    .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
    .export-card{background:var(--card);border-radius:16px;padding:20px;border:1px solid var(--border);transition:all .2s}
    .export-card:hover{border-color:var(--primary);transform:translateY(-2px)}
    .card-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:14px}
    .card-title{font-size:15px;font-weight:700;color:#fff;margin-bottom:6px}
    .card-desc{font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:14px}
    .card-meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
    .meta-tag{padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;background:#1a2535;border:1px solid var(--border);color:var(--muted)}
    .btn-download{width:100%;padding:11px;border-radius:10px;border:none;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:7px;transition:all .2s}
    .btn-green{background:var(--primary);color:#fff} .btn-green:hover{background:#15803d}
    .btn-blue{background:#0891b2;color:#fff} .btn-blue:hover{background:#0e7490}
    .btn-purple{background:#7c3aed;color:#fff} .btn-purple:hover{background:#6d28d9}
    .btn-orange{background:#d97706;color:#fff} .btn-orange:hover{background:#b45309}
    .btn-slate{background:#475569;color:#fff} .btn-slate:hover{background:#374151}
    .info-box{background:var(--card);border-radius:16px;padding:20px;border:1px solid #1e40af;border-left:4px solid #3b82f6;margin-bottom:24px}
    .info-box h3{font-size:14px;font-weight:700;color:#93c5fd;margin-bottom:10px}
    .info-box p,li{font-size:12px;color:var(--muted);line-height:1.7}
    .info-box ol,ul{padding-left:16px}
    .qgis-steps{background:var(--card);border-radius:16px;padding:24px;border:1px solid var(--border);margin-top:24px}
    .step{display:flex;gap:16px;margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid var(--border)}
    .step:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}
    .step-num{width:36px;height:36px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;flex-shrink:0}
    .step-content h4{font-size:13px;font-weight:700;color:#fff;margin-bottom:4px}
    .step-content p{font-size:12px;color:var(--muted);line-height:1.6}
    code{background:#0f172a;padding:2px 7px;border-radius:4px;font-size:11px;color:#86efac;font-family:monospace}
    #preview-box{background:#0f172a;border:1px solid var(--border);border-radius:12px;padding:16px;margin-top:16px;overflow-x:auto}
    pre{font-size:11px;color:#86efac;font-family:monospace;white-space:pre;line-height:1.6}
    .layer-options{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:14px}
    .layer-opt{display:flex;align-items:center;gap:8px;background:#0f172a;border:1px solid var(--border);border-radius:8px;padding:8px 12px;cursor:pointer}
    .layer-opt input{accent-color:var(--primary)}
    .layer-opt label{font-size:12px;cursor:pointer}
  </style>
</head>
<body>
<header>
  <a class="back-btn" href="/"><i class="fas fa-arrow-left"></i> Retour carte</a>
  <div>
    <h1><i class="fas fa-download" style="color:#16a34a;margin-right:8px"></i>Export QGIS — GeoTouba</h1>
    <p class="sub">Génération de fichiers géospatiaux compatibles QGIS, ArcGIS et SIG desktop</p>
  </div>
</header>

<main>
  <div class="info-box">
    <h3><i class="fas fa-info-circle"></i> Système de coordonnées</h3>
    <p>Tous les exports utilisent <strong style="color:#93c5fd">WGS84 (EPSG:4326)</strong> — le standard international pour les données GPS.</p>
    <p style="margin-top:6px">Pour travailler en coordonnées métriques locales, reprojetez vers <strong style="color:#93c5fd">UTM Zone 28N (EPSG:32628)</strong> dans QGIS.</p>
  </div>

  <!-- EXPORTS GEOJSON -->
  <div class="section">
    <div class="section-title"><i class="fas fa-map"></i> Export GeoJSON (QGIS natif)</div>
    <div class="cards">
      <div class="export-card">
        <div class="card-icon" style="background:rgba(22,163,74,.15)">🗑️</div>
        <div class="card-title">Points de collecte</div>
        <div class="card-desc">Tous les points de collecte de déchets organiques avec attributs complets (type, statut, capacité, taux remplissage, responsable…)</div>
        <div class="card-meta">
          <span class="meta-tag">GeoJSON</span><span class="meta-tag">WGS84</span><span class="meta-tag">60 entités</span>
        </div>
        <button class="btn-download btn-green" onclick="downloadGeoJson('points')">
          <i class="fas fa-download"></i> Télécharger points.geojson
        </button>
      </div>
      <div class="export-card">
        <div class="card-icon" style="background:rgba(245,158,11,.15)">🗺️</div>
        <div class="card-title">Centres de quartiers</div>
        <div class="card-desc">Centroïdes des 42 quartiers (13 historiques + 14 villages + 15 périphériques) avec population estimée, superficie et niveau administratif.</div>
        <div class="card-meta">
          <span class="meta-tag">GeoJSON</span><span class="meta-tag">WGS84</span><span class="meta-tag">42 entités</span>
        </div>
        <button class="btn-download btn-orange" onclick="downloadGeoJson('quartiers')">
          <i class="fas fa-download"></i> Télécharger quartiers.geojson
        </button>
      </div>
      <div class="export-card">
        <div class="card-icon" style="background:rgba(234,88,12,.15)">🍽️</div>
        <div class="card-title">Sources de déchets</div>
        <div class="card-desc">Restaurants, cuisines dahiras et autres sources majeures de déchets organiques avec estimation de production journalière.</div>
        <div class="card-meta">
          <span class="meta-tag">GeoJSON</span><span class="meta-tag">WGS84</span><span class="meta-tag">6 entités</span>
        </div>
        <button class="btn-download btn-orange" onclick="downloadGeoJson('restaurants')">
          <i class="fas fa-download"></i> Télécharger restaurants.geojson
        </button>
      </div>
      <div class="export-card">
        <div class="card-icon" style="background:rgba(13,148,136,.15)">🌿</div>
        <div class="card-title">Projets de valorisation</div>
        <div class="card-desc">Compostage, biogaz et projets de collecte sélective existants avec partenaires et budget.</div>
        <div class="card-meta">
          <span class="meta-tag">GeoJSON</span><span class="meta-tag">WGS84</span><span class="meta-tag">3 entités</span>
        </div>
        <button class="btn-download btn-blue" onclick="downloadGeoJson('projets')">
          <i class="fas fa-download"></i> Télécharger projets.geojson
        </button>
      </div>
      <div class="export-card">
        <div class="card-icon" style="background:rgba(124,58,237,.15)">🗂️</div>
        <div class="card-title">Toutes les couches</div>
        <div class="card-desc">FeatureCollection complète : 60 points de collecte + 42 quartiers + restaurants + projets dans un seul fichier GeoJSON.</div>
        <div class="card-meta">
          <span class="meta-tag">GeoJSON</span><span class="meta-tag">WGS84</span><span class="meta-tag">111 entités</span>
        </div>
        <button class="btn-download btn-purple" onclick="downloadGeoJson('all')">
          <i class="fas fa-download"></i> Télécharger toutes_couches.geojson
        </button>
      </div>
    </div>
  </div>

  <!-- EXPORT CSV -->
  <div class="section">
    <div class="section-title"><i class="fas fa-table"></i> Export CSV (tableur + QGIS)</div>
    <div class="cards">
      <div class="export-card">
        <div class="card-icon" style="background:rgba(8,145,178,.15)">📊</div>
        <div class="card-title">Points de collecte — CSV</div>
        <div class="card-desc">Tableau de données avec colonnes lat/lng importables dans QGIS via "Couche → Ajouter une couche → Couche texte délimité".</div>
        <div class="card-meta">
          <span class="meta-tag">CSV UTF-8</span><span class="meta-tag">Colonnes lat/lng</span>
        </div>
        <button class="btn-download btn-blue" onclick="downloadCsv()">
          <i class="fas fa-file-csv"></i> Télécharger points.csv
        </button>
      </div>
      <div class="export-card">
        <div class="card-icon" style="background:rgba(245,158,11,.15)">📋</div>
        <div class="card-title">Rapport d'alertes</div>
        <div class="card-desc">Export des bacs en alerte (remplissage ≥ 80%) pour intervention terrain immédiate.</div>
        <div class="card-meta">
          <span class="meta-tag">CSV</span><span class="meta-tag">Alertes actives</span>
        </div>
        <button class="btn-download btn-orange" onclick="downloadAlertsCsv()">
          <i class="fas fa-exclamation-triangle"></i> Télécharger alertes.csv
        </button>
      </div>
    </div>
  </div>

  <!-- PRÉVISUALISATION GEOJSON -->
  <div class="section">
    <div class="section-title"><i class="fas fa-code"></i> Prévisualisation GeoJSON</div>
    <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
      <button onclick="previewLayer('points')" style="background:#16a34a;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit">🗑️ Points collecte</button>
      <button onclick="previewLayer('restaurants')" style="background:#ea580c;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit">🍽️ Restaurants</button>
      <button onclick="previewLayer('projets')" style="background:#0d9488;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit">🌿 Projets</button>
    </div>
    <div id="preview-box">
      <pre id="geojson-preview">Cliquez sur une couche pour prévisualiser le GeoJSON...</pre>
    </div>
  </div>

  <!-- GUIDE QGIS -->
  <div class="section">
    <div class="section-title"><i class="fas fa-book"></i> Guide d'import QGIS</div>
    <div class="qgis-steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-content">
          <h4>Télécharger les fichiers GeoJSON</h4>
          <p>Cliquez sur les boutons ci-dessus pour télécharger les couches souhaitées en format <code>.geojson</code></p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-content">
          <h4>Importer dans QGIS</h4>
          <p>Dans QGIS : <code>Couche → Ajouter une couche → Vecteur</code> → sélectionnez le fichier .geojson téléchargé. Ou glisser-déposer directement dans le canevas.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-content">
          <h4>Reprojection (optionnel)</h4>
          <p>Pour des analyses métriques (distances, surfaces) : <code>Vecteur → Outils de gestion → Reprojeter la couche</code> → sélectionnez <code>EPSG:32628 (UTM 28N)</code></p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-content">
          <h4>Symbologie par taux de remplissage</h4>
          <p>Double-clic sur la couche → Symbologie → Gradué → Colonne : <code>taux_remplissage</code> → Classification : 5 classes → Mode : Intervalles égaux → Appliquer</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">5</div>
        <div class="step-content">
          <h4>Joindre avec OpenStreetMap</h4>
          <p>Ajouter un fond OSM via : <code>XYZ Tiles → OpenStreetMap</code> dans le panneau Explorateur de QGIS. URL : <code>https://tile.openstreetmap.org/{z}/{x}/{y}.png</code></p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">6</div>
        <div class="step-content">
          <h4>Export carte finale</h4>
          <p><code>Projet → Nouvelle mise en page d'impression</code> → Ajouter carte, légende, titre → Exporter en PDF ou image haute résolution.</p>
        </div>
      </div>
    </div>
  </div>
</main>

<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script>
async function downloadGeoJson(layer) {
  try {
    const resp = await fetch(\`/api/export/geojson?layer=\${layer}\`)
    const data = await resp.json()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const names = { points: 'points_collecte', restaurants: 'sources_dechets', projets: 'projets_valorisation', all: 'toutes_couches_geotouba' }
    a.download = \`geotouba_\${names[layer] || layer}_\${new Date().toISOString().slice(0,10)}.geojson\`
    a.click()
    URL.revokeObjectURL(url)
  } catch(e) { alert('Erreur de téléchargement: ' + e.message) }
}

async function downloadCsv() {
  const resp = await fetch('/api/export/csv')
  const text = await resp.text()
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = \`geotouba_points_\${new Date().toISOString().slice(0,10)}.csv\`
  a.click()
}

async function downloadAlertsCsv() {
  const resp = await axios.get('/api/alertes')
  const alerts = resp.data.data
  if (!alerts.length) { alert('Aucune alerte active actuellement'); return }
  const headers = ['id','nom','quartier','taux_remplissage','niveau','message','lat','lng','responsable','timestamp']
  const rows = alerts.map(a => headers.map(h => a[h] ?? '').join(','))
  const csv = [headers.join(','), ...rows].join('\\n')
  const blob = new Blob(['\\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = \`alertes_\${new Date().toISOString().slice(0,10)}.csv\`
  a.click()
}

async function previewLayer(layer) {
  try {
    const resp = await fetch(\`/api/export/geojson?layer=\${layer}\`)
    const data = await resp.json()
    const preview = { ...data, features: data.features.slice(0, 2) }
    document.getElementById('geojson-preview').textContent = JSON.stringify(preview, null, 2).slice(0, 3000) + '\\n\\n... (' + data.features.length + ' entités au total)'
  } catch(e) {
    document.getElementById('geojson-preview').textContent = 'Erreur: ' + e.message
  }
}
</script>
</body>
</html>`
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE ALERTES
// ═══════════════════════════════════════════════════════════════════════════
function getAlertesHtml(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alertes & Notifications — GeoTouba</title>
  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root{--primary:#16a34a;--danger:#ef4444;--warning:#f59e0b;--dark:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#64748b}
    *{box-sizing:border-box;margin:0;padding:0} body{font-family:'Inter',sans-serif;background:var(--dark);color:var(--text)}
    header{background:linear-gradient(135deg,#0f172a,#1a1a2e);padding:20px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px;flex-wrap:wrap}
    .back-btn{background:var(--card);border:1px solid var(--border);color:var(--text);padding:8px 14px;border-radius:8px;font-size:13px;cursor:pointer;text-decoration:none;display:flex;align-items:center;gap:6px}
    h1{font-size:20px;font-weight:800;color:#fff} .sub{font-size:13px;color:var(--muted);margin-top:2px}
    main{max-width:1100px;margin:0 auto;padding:24px}
    .top-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:32px}
    .kpi-card{background:var(--card);border-radius:14px;padding:16px;border:1px solid var(--border)}
    .kpi-card.danger{border-left:4px solid var(--danger)} .kpi-card.warning{border-left:4px solid var(--warning)}
    .kpi-card.success{border-left:4px solid var(--primary)} .kpi-card.info{border-left:4px solid #0891b2}
    .kpi-val{font-size:28px;font-weight:800} .kpi-lbl{font-size:11px;color:var(--muted);margin-top:3px}
    .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-bottom:16px;display:flex;align-items:center;gap:8px}
    .section-title::before{content:'';width:3px;height:14px;background:var(--primary);border-radius:2px}
    .two-col{display:grid;grid-template-columns:1fr 1fr;gap:24px} @media(max-width:700px){.two-col{grid-template-columns:1fr}}
    .panel{background:var(--card);border-radius:16px;padding:20px;border:1px solid var(--border)}
    .alert-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)}
    .alert-row:last-child{border-bottom:none}
    .alert-icon{width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
    .alert-icon.crit{background:rgba(239,68,68,.15)} .alert-icon.warn{background:rgba(245,158,11,.15)}
    .alert-name{font-size:13px;font-weight:700;color:#fff} .alert-sub{font-size:11px;color:var(--muted);margin-top:2px}
    .alert-right{text-align:right;flex-shrink:0}
    .fill-big{font-size:20px;font-weight:800} .fill-time{font-size:10px;color:var(--muted);margin-top:2px}
    .notif-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)}
    .notif-row:last-child{border-bottom:none} .notif-label{font-size:13px;color:var(--text)} .notif-sub{font-size:11px;color:var(--muted);margin-top:2px}
    .toggle-sw{position:relative;width:44px;height:24px;cursor:pointer;flex-shrink:0}
    .toggle-sw input{display:none}
    .toggle-sl{position:absolute;inset:0;background:#334155;border-radius:12px;transition:.3s}
    .toggle-sl::before{content:'';position:absolute;width:18px;height:18px;background:#fff;border-radius:50%;top:3px;left:3px;transition:.3s}
    .toggle-sw input:checked+.toggle-sl{background:var(--primary)}
    .toggle-sw input:checked+.toggle-sl::before{transform:translateX(20px)}
    .config-row{display:flex;gap:10px;margin-bottom:12px}
    .config-input{flex:1;background:var(--dark);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px;font-size:13px;font-family:inherit}
    .config-input:focus{outline:none;border-color:var(--primary)}
    .btn-sm{padding:10px 16px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px;transition:all .2s}
    .btn-green{background:var(--primary);color:#fff} .btn-red{background:var(--danger);color:#fff}
    .btn-blue{background:#0891b2;color:#fff} .btn-ghost{background:var(--border);color:var(--text)}
    .threshold-row{display:flex;align-items:center;gap:12px;margin-bottom:16px}
    .threshold-label{font-size:13px;font-weight:600;color:var(--text);flex-shrink:0;min-width:100px}
    input[type=range]{flex:1;-webkit-appearance:none;height:6px;border-radius:3px;background:#334155;outline:none}
    input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:var(--warning);cursor:pointer}
    .threshold-val{font-size:15px;font-weight:800;color:var(--warning);width:42px;text-align:center;flex-shrink:0}
    .history-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1e293b;font-size:12px}
    .history-row:last-child{border-bottom:none}
    .hist-badge{padding:3px 8px;border-radius:20px;font-size:10px;font-weight:700;flex-shrink:0}
    .hist-sent{background:rgba(22,163,74,.2);color:#16a34a}
    .hist-failed{background:rgba(239,68,68,.2);color:#ef4444}
    #toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#064e3b;color:#6ee7b7;border:1px solid #10b981;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:600;z-index:100;opacity:0;transition:all .3s;white-space:nowrap;pointer-events:none}
    #toast.show{opacity:1}
    .live-dot{width:8px;height:8px;border-radius:50%;background:var(--primary);animation:pulse 2s infinite;display:inline-block;margin-right:6px}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  </style>
</head>
<body>
<header>
  <a class="back-btn" href="/"><i class="fas fa-arrow-left"></i> Carte</a>
  <div style="flex:1">
    <h1><i class="fas fa-bell" style="color:#ef4444;margin-right:8px"></i>Alertes & Notifications</h1>
    <p class="sub"><span class="live-dot"></span>Surveillance temps réel — seuil d'alerte configurable</p>
  </div>
  <a class="back-btn" href="/agent"><i class="fas fa-mobile-alt"></i> App agent</a>
  <a class="back-btn" href="/export"><i class="fas fa-download"></i> Export QGIS</a>
</header>

<main>
  <!-- KPIs -->
  <div class="top-grid" id="kpi-grid">
    <div class="kpi-card danger"><div class="kpi-val" id="kpi-critique" style="color:#ef4444">—</div><div class="kpi-lbl">🔴 Bacs critiques (≥90%)</div></div>
    <div class="kpi-card warning"><div class="kpi-val" id="kpi-warning" style="color:#f59e0b">—</div><div class="kpi-lbl">🟡 Bacs en alerte (≥80%)</div></div>
    <div class="kpi-card success"><div class="kpi-val" id="kpi-normal" style="color:#16a34a">—</div><div class="kpi-lbl">🟢 Bacs normaux</div></div>
    <div class="kpi-card info"><div class="kpi-val" id="kpi-total" style="color:#0891b2">—</div><div class="kpi-lbl">📍 Total points actifs</div></div>
  </div>

  <div class="two-col">
    <!-- PANEL GAUCHE: Alertes actives + Config notifications -->
    <div>
      <div class="section-title"><i class="fas fa-fire-alt"></i> Bacs en alerte active</div>
      <div class="panel" id="alerts-panel">
        <div style="text-align:center;padding:20px;color:var(--muted)"><i class="fas fa-spinner fa-spin"></i> Chargement...</div>
      </div>

      <div style="margin-top:24px">
        <div class="section-title"><i class="fas fa-sliders-h"></i> Seuil d'alerte configurable</div>
        <div class="panel">
          <div class="threshold-row">
            <span class="threshold-label">⚠️ Avertissement</span>
            <input type="range" id="thresh-warn" min="50" max="95" value="80" oninput="updateThresholds()">
            <span class="threshold-val" id="thresh-warn-val">80%</span>
          </div>
          <div class="threshold-row">
            <span class="threshold-label">🔴 Critique</span>
            <input type="range" id="thresh-crit" min="60" max="100" value="90" oninput="updateThresholds()">
            <span class="threshold-val" id="thresh-crit-val" style="color:#ef4444">90%</span>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:8px">Les alertes sont déclenchées automatiquement et rafraîchies toutes les 2 minutes.</div>
        </div>
      </div>
    </div>

    <!-- PANEL DROITE: Configuration notifications -->
    <div>
      <div class="section-title"><i class="fas fa-paper-plane"></i> Configuration des notifications</div>
      <div class="panel" style="margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:14px">📱 Canaux de notification</div>

        <div class="notif-row">
          <div>
            <div class="notif-label"><i class="fas fa-sms" style="color:#16a34a"></i> SMS (Twilio / Orange Money)</div>
            <div class="notif-sub">Alerte immédiate sur téléphone field agent</div>
          </div>
          <label class="toggle-sw"><input type="checkbox" id="notif-sms" checked><span class="toggle-sl"></span></label>
        </div>
        <div class="notif-row" style="padding-left:20px;background:#0f172a;border-radius:8px;margin-bottom:4px">
          <div class="config-row" style="margin-bottom:0;width:100%;padding:8px 0">
            <input class="config-input" id="sms-number" type="tel" placeholder="+221 77 XXX XXXX" value="+221 77 000 0000">
            <button class="btn-sm btn-green" onclick="testNotif('sms')"><i class="fas fa-paper-plane"></i> Test</button>
          </div>
        </div>

        <div class="notif-row" style="margin-top:8px">
          <div>
            <div class="notif-label"><i class="fas fa-envelope" style="color:#0891b2"></i> Email (SMTP / Resend)</div>
            <div class="notif-sub">Rapport détaillé aux coordinateurs</div>
          </div>
          <label class="toggle-sw"><input type="checkbox" id="notif-email" checked><span class="toggle-sl"></span></label>
        </div>
        <div style="padding-left:20px;background:#0f172a;border-radius:8px;margin-bottom:4px">
          <div class="config-row" style="padding:8px 0;margin-bottom:0">
            <input class="config-input" id="email-addr" type="email" placeholder="coordinateur@touba.sn">
            <button class="btn-sm btn-blue" onclick="testNotif('email')"><i class="fas fa-paper-plane"></i> Test</button>
          </div>
        </div>

        <div class="notif-row" style="margin-top:8px">
          <div>
            <div class="notif-label"><i class="fas fa-bell" style="color:#f59e0b"></i> Push navigateur (PWA)</div>
            <div class="notif-sub">Notification directe dans l'app agent</div>
          </div>
          <label class="toggle-sw"><input type="checkbox" id="notif-push" checked><span class="toggle-sl"></span></label>
        </div>
        <div style="margin-top:12px">
          <button class="btn-sm btn-ghost" style="width:100%" onclick="requestPushPermission()"><i class="fas fa-bell"></i> Activer les notifications push</button>
        </div>
      </div>

      <!-- Destinataires -->
      <div class="section-title"><i class="fas fa-users"></i> Destinataires configurés</div>
      <div class="panel">
        <div id="destinataires-list">
          <div class="notif-row">
            <div><div class="notif-label">👷 Coordinateur SIG</div><div class="notif-sub">coord.sig@touba.sn · +221 77 000 0001</div></div>
            <span style="background:rgba(22,163,74,.2);color:#16a34a;padding:3px 8px;border-radius:20px;font-size:10px;font-weight:700">✅ Actif</span>
          </div>
          <div class="notif-row">
            <div><div class="notif-label">🚛 Chef collecte</div><div class="notif-sub">chef.collecte@mairie-touba.sn · +221 76 000 0002</div></div>
            <span style="background:rgba(22,163,74,.2);color:#16a34a;padding:3px 8px;border-radius:20px;font-size:10px;font-weight:700">✅ Actif</span>
          </div>
          <div class="notif-row">
            <div><div class="notif-label">🕌 Comité Magal Env.</div><div class="notif-sub">magal.env@comite-touba.sn</div></div>
            <span style="background:rgba(245,158,11,.2);color:#f59e0b;padding:3px 8px;border-radius:20px;font-size:10px;font-weight:700">📅 Magal uniquement</span>
          </div>
        </div>
        <button class="btn-sm btn-ghost" style="width:100%;margin-top:12px" onclick="addDestinataire()">
          <i class="fas fa-plus"></i> Ajouter un destinataire
        </button>
      </div>

      <!-- Historique -->
      <div style="margin-top:24px">
        <div class="section-title"><i class="fas fa-history"></i> Historique récent (24h)</div>
        <div class="panel">
          <div id="history-list">
            <div class="history-row"><span class="hist-badge hist-sent">✓ Envoyé</span><div style="flex:1"><div style="color:#fff;font-size:12px">SMS: Bac Gare Routière à 91%</div><div style="color:var(--muted);font-size:10px">Il y a 2h · +221 77 000 0001</div></div></div>
            <div class="history-row"><span class="hist-badge hist-sent">✓ Envoyé</span><div style="flex:1"><div style="color:#fff;font-size:12px">Email: Rapport alertes quotidien</div><div style="color:var(--muted);font-size:10px">Il y a 6h · coord.sig@touba.sn</div></div></div>
            <div class="history-row"><span class="hist-badge hist-sent">✓ Envoyé</span><div style="flex:1"><div style="color:#fff;font-size:12px">Push: Bac Gouye Mbind à 83%</div><div style="color:var(--muted);font-size:10px">Il y a 8h · App Agent</div></div></div>
            <div class="history-row"><span class="hist-badge hist-failed">✗ Échec</span><div style="flex:1"><div style="color:#fff;font-size:12px">SMS: timeout réseau</div><div style="color:var(--muted);font-size:10px">Il y a 12h · Retentative programmée</div></div></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</main>

<div id="toast"></div>

<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script>
let threshWarn = 80, threshCrit = 90

function updateThresholds() {
  threshWarn = parseInt(document.getElementById('thresh-warn').value)
  threshCrit = parseInt(document.getElementById('thresh-crit').value)
  document.getElementById('thresh-warn-val').textContent = threshWarn + '%'
  document.getElementById('thresh-crit-val').textContent = threshCrit + '%'
  loadAlerts()
}

async function loadAlerts() {
  try {
    const [alertsR, pointsR] = await Promise.all([
      axios.get('/api/alertes'),
      axios.get('/api/points-collecte')
    ])
    const alerts = alertsR.data.data
    const allP = pointsR.data.data
    const actifs = allP.filter(p => p.statut === 'actif')
    const critiques = actifs.filter(p => p.taux_remplissage >= threshCrit).length
    const warnings = actifs.filter(p => p.taux_remplissage >= threshWarn && p.taux_remplissage < threshCrit).length
    const normaux = actifs.filter(p => p.taux_remplissage < threshWarn).length

    document.getElementById('kpi-critique').textContent = critiques
    document.getElementById('kpi-warning').textContent = warnings
    document.getElementById('kpi-normal').textContent = normaux
    document.getElementById('kpi-total').textContent = actifs.length

    const panel = document.getElementById('alerts-panel')
    if (!alerts.length) {
      panel.innerHTML = '<div style="text-align:center;padding:20px;color:#16a34a">✅ Aucun bac en alerte</div>'
      return
    }
    panel.innerHTML = alerts.map(a => \`
      <div class="alert-row">
        <div class="alert-icon \${a.niveau==='critique'?'crit':'warn'}">\${a.taux_remplissage>=threshCrit?'🔴':'🟡'}</div>
        <div style="flex:1">
          <div class="alert-name">\${a.nom}</div>
          <div class="alert-sub"><i class="fas fa-map-marker-alt"></i> \${a.quartier} · <i class="fas fa-user"></i> \${a.responsable}</div>
        </div>
        <div class="alert-right">
          <div class="fill-big" style="color:\${a.niveau==='critique'?'#ef4444':'#f59e0b'}">\${a.taux_remplissage}%</div>
          <div class="fill-time">⏰ Intervention requise</div>
        </div>
      </div>
    \`).join('')
  } catch(e) { console.error(e) }
}

async function testNotif(channel) {
  const dest = channel === 'sms' ? document.getElementById('sms-number').value : document.getElementById('email-addr').value
  if (!dest) { showToast('⚠️ Entrez un destinataire'); return }
  try {
    const resp = await axios.post('/api/notifications/test', { channel, [channel==='sms'?'phone':'email']: dest })
    showToast(\`✅ Test \${channel.toUpperCase()} envoyé → \${dest}\`)
  } catch { showToast('❌ Erreur lors de l\\'envoi') }
}

async function requestPushPermission() {
  if (!('Notification' in window)) { showToast('❌ Notifications non supportées'); return }
  const perm = await Notification.requestPermission()
  if (perm === 'granted') {
    showToast('🔔 Notifications push activées !')
    new Notification('GeoTouba — Actif', { body: 'Vous recevrez les alertes en temps réel', icon: '/static/favicon.svg' })
  } else {
    showToast('❌ Permission notifications refusée')
  }
}

function addDestinataire() {
  const nom = prompt('Nom du destinataire :')
  const contact = prompt('Email ou téléphone :')
  if (!nom || !contact) return
  const list = document.getElementById('destinataires-list')
  list.innerHTML += \`
    <div class="notif-row">
      <div><div class="notif-label">👤 \${nom}</div><div class="notif-sub">\${contact}</div></div>
      <span style="background:rgba(22,163,74,.2);color:#16a34a;padding:3px 8px;border-radius:20px;font-size:10px;font-weight:700">✅ Ajouté</span>
    </div>
  \`
  showToast(\`✅ \${nom} ajouté aux destinataires\`)
}

let toastT = null
function showToast(msg) {
  const t = document.getElementById('toast')
  t.textContent = msg; t.classList.add('show')
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3000)
}

loadAlerts()
setInterval(loadAlerts, 2 * 60 * 1000)
</script>
</body>
</html>`
}
