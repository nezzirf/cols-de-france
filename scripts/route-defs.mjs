// Définition des parcours. Tout ce qui est ici sert à interroger des sources réelles :
// - `via`  : points de passage donnés au routeur OSM, qui renvoie la géométrie de la vraie route ;
// - `pois` : coordonnées relevées sur OpenStreetMap (nœuds nommés, requêtes Overpass) ;
// - `official` : chiffres publiés, utilisés uniquement pour vérifier le tracé calculé.
// Coordonnées : [latitude, longitude].

export const ROUTES = [
  {
    id: 'alpe-dhuez',
    name: "Alpe d'Huez",
    subtitle: "Depuis Rochetaillée par Le Bourg-d'Oisans",
    massif: 'Oisans',
    via: [
      [45.1148, 6.0048], // Rochetaillée, D1091
      [45.0717, 6.0393], // D211, virage de la Savoyâte
      [45.0810, 6.0590], // Huez
      [45.0941, 6.0709], // Arrivée
    ],
    after: [[45.0955, 6.0745]], // la route continue dans la station
    footFromEndKm: 13.8,
    official: { lengthKm: 13.8, avgGradePct: 8.1, tolerance: { lengthKm: 1.2, grade: 0.8 } },
    hairpins: {
      expected: 21,
      minTurnDeg: 90,
      windowM: 90,
      minGapM: 220,
      skipFirstM: 800, // rond-point du pied, pas un lacet
      maxEle: 1720, // au-delà : les rues de la station, sans panneau numéroté
      // Virages nommés sur OpenStreetMap (historic=memorial)
      named: [
        ['Virage de la Savoyâte', 45.07195, 6.03917],
        ['Virage des Grangettes', 45.06811, 6.04198],
        ['Virage de la Coute', 45.06901, 6.04276],
        ['Virage de la Citerna', 45.07204, 6.04815],
        ['Virage du Château', 45.07093, 6.04416],
        ['Virage du Charretier', 45.07245, 6.05134],
        ['Virage Céleste', 45.0747, 6.05245],
        ['Virage de Saint-Ferréol', 45.07697, 6.05337],
        ['Virage de Saint-Claude', 45.08222, 6.0625],
        ['Virage des Jardins', 45.08857, 6.06062],
        ['Virage des Combes', 45.09164, 6.05539],
      ],
    },
    buildingStyle: 'alpes',
    biomes: { valley: 950, forest: 1650, alpage: 2300, rock: 'gris', trees: 'mixte' },
    pois: [
      { name: "Église de La Garde", type: 'eglise', at: [45.06702, 6.04421] },
      { name: 'Église Saint-Ferréol', type: 'eglise', at: [45.07742, 6.05327] },
      { name: 'Église Sainte-Anne de Huez', type: 'eglise', at: [45.08091, 6.05759] },
      { name: 'Huez', type: 'village', at: [45.08209, 6.05964] },
      { name: "L'Alpe d'Huez", type: 'village', at: [45.09240, 6.06994] },
      { name: "Le Bourg-d'Oisans", type: 'village', at: [45.05471, 6.03066] },
      { name: "Mémorial des vainqueurs d'étape", type: 'stele', at: [45.09412, 6.07147] },
    ],
    segments: [
      { name: "Montée de l'Alpe d'Huez", from: 'foot', to: 'end' },
      { name: 'Virages 21 à 16', from: 'hairpin:21', to: 'hairpin:16' },
      { name: 'Virages 15 à 7', from: 'hairpin:15', to: 'hairpin:7' },
      { name: 'Virages 6 à 1', from: 'hairpin:6', to: 'hairpin:1' },
    ],
  },
  {
    id: 'ventoux',
    name: 'Mont Ventoux',
    subtitle: 'Depuis Caromb par Bédoin',
    massif: 'Vaucluse',
    via: [
      [44.1136, 5.1063], // Caromb
      [44.1238, 5.1825], // Bédoin, sur la route qui traverse le village
      [44.1140, 5.2399], // Saint-Estève
      [44.1697, 5.2860], // Stèle Tom Simpson
      [44.1740, 5.2788], // Sommet
    ],
    after: [[44.1770, 5.2640]], // descente vers le Mont Serein
    foot: [44.1240, 5.1800],
    official: { lengthKm: 21.5, avgGradePct: 7.5, tolerance: { lengthKm: 1.2, grade: 0.8 } },
    buildingStyle: 'provence',
    biomes: { valley: 650, forest: 1480, alpage: 1540, rock: 'calcaire', trees: 'cedre' },
    pois: [
      { name: 'Bédoin', type: 'village', at: [44.12404, 5.18066] },
      { name: 'Saint-Estève', type: 'village', at: [44.11397, 5.23989] },
      { name: 'Chalet Reynard', type: 'chalet', at: [44.15239, 5.31905] },
      { name: 'Pierre de Champeville', type: 'stele', at: [44.15203, 5.31912] },
      { name: 'Mémorial Tom Simpson', type: 'stele', at: [44.16971, 5.28618] },
      { name: 'Mémorial Pierre Kraemer', type: 'stele', at: [44.17038, 5.28551] },
      { name: 'Col des Tempêtes', type: 'col', at: [44.17416, 5.28375] },
      { name: 'Monument Bruges - Mont Ventoux', type: 'stele', at: [44.17429, 5.28286] },
      { name: 'Émetteur du Mont Ventoux', type: 'tour', at: [44.17376, 5.27778] },
    ],
    segments: [
      { name: 'Ascension du Ventoux', from: 'foot', to: 'end' },
      { name: 'Bédoin - Saint-Estève', from: 'foot', to: 'poi:Saint-Estève' },
      { name: 'La forêt : Saint-Estève - Chalet Reynard', from: 'poi:Saint-Estève', to: 'poi:Chalet Reynard' },
      { name: 'Le pierrier : Chalet Reynard - Sommet', from: 'poi:Chalet Reynard', to: 'end' },
    ],
  },
  {
    id: 'tourmalet',
    name: 'Col du Tourmalet',
    subtitle: 'Versant est, depuis Campan par Sainte-Marie',
    massif: 'Pyrénées',
    via: [
      [43.0163, 0.1785], // Campan
      [42.9846, 0.2266], // Sainte-Marie-de-Campan
      [42.9119, 0.1777], // La Mongie
      [42.9084, 0.1455], // Col
    ],
    after: [[42.9050, 0.1330]], // descente vers Barèges
    foot: [42.9846, 0.2266],
    official: { lengthKm: 17.2, avgGradePct: 7.4, tolerance: { lengthKm: 1.2, grade: 0.8 } },
    buildingStyle: 'pyrenees',
    biomes: { valley: 1050, forest: 1550, alpage: 2050, rock: 'gris', trees: 'hetre' },
    pois: [
      { name: 'Église de Sainte-Marie-de-Campan', type: 'eglise', at: [42.98475, 0.22716] },
      { name: 'Stèle Eugène Christophe', type: 'stele', at: [42.98438, 0.22698] },
      { name: 'Gripp', type: 'village', at: [42.94664, 0.22240] },
      { name: 'La Mongie', type: 'village', at: [42.91192, 0.17768] },
      { name: 'Chapelle Notre-Dame des Neiges', type: 'eglise', at: [42.91027, 0.17714] },
      { name: 'Le Géant du Tourmalet', type: 'statue', at: [42.90822, 0.14493] },
      { name: 'Mémorial Jacques Goddet', type: 'stele', at: [42.90843, 0.14527] },
      { name: 'Maison Octave', type: 'chalet', at: [42.90812, 0.14524] },
    ],
    segments: [
      { name: 'Ascension du Tourmalet', from: 'foot', to: 'end' },
      { name: 'Sainte-Marie - Gripp', from: 'foot', to: 'poi:Gripp' },
      { name: 'Gripp - La Mongie', from: 'poi:Gripp', to: 'poi:La Mongie' },
      { name: 'La Mongie - Col', from: 'poi:La Mongie', to: 'end' },
    ],
  },
  {
    id: 'galibier',
    name: 'Col du Galibier',
    subtitle: 'Par le Télégraphe et Valloire, depuis Saint-Martin-de-la-Porte',
    massif: 'Maurienne',
    via: [
      [45.2399, 6.4455], // Saint-Martin-de-la-Porte
      [45.2027, 6.4446], // Col du Télégraphe
      [45.0641, 6.4077], // Col du Galibier
    ],
    after: [[45.0617, 6.4057]], // versant sud, vers le monument Desgrange
    footFromEndKm: 34.8,
    official: { lengthKm: 34.8, avgGradePct: 5.5, tolerance: { lengthKm: 1.2, grade: 0.8 } },
    buildingStyle: 'alpes',
    biomes: { valley: 1050, forest: 1750, alpage: 2350, rock: 'schiste', trees: 'sapin' },
    pois: [
      { name: 'Saint-Michel-de-Maurienne', type: 'village', at: [45.21788, 6.47508] },
      { name: 'Col du Télégraphe', type: 'col', at: [45.20270, 6.44461] },
      { name: 'Valloire', type: 'village', at: [45.16500, 6.42964] },
      { name: 'Les Verneys', type: 'village', at: [45.14844, 6.42063] },
      { name: 'Bonnenuit', type: 'village', at: [45.12064, 6.42155] },
      { name: 'Monument Henri Desgrange', type: 'stele', at: [45.06175, 6.40557], offRoute: true },
    ],
    segments: [
      { name: 'Télégraphe + Galibier', from: 'foot', to: 'end' },
      { name: 'Col du Télégraphe', from: 'foot', to: 'poi:Col du Télégraphe' },
      { name: 'Valloire - Col du Galibier', from: 'poi:Valloire', to: 'end' },
      { name: 'Bonnenuit - Col du Galibier', from: 'poi:Bonnenuit', to: 'end' },
    ],
  },
  {
    id: 'izoard',
    name: "Col d'Izoard",
    subtitle: 'Versant sud par le Queyras et la Casse Déserte',
    massif: 'Queyras',
    via: [
      [44.6700, 6.6260], // Eygliers
      [44.6590, 6.6480], // Guillestre
      [44.7650, 6.7390], // Arvieux
      [44.8113, 6.7368], // Casse Déserte
      [44.8197, 6.7350], // Col
    ],
    after: [[44.8230, 6.7330]], // descente vers le refuge Napoléon
    foot: [44.6590, 6.6480],
    official: { lengthKm: 31.5, avgGradePct: 4.3, tolerance: { lengthKm: 1.2, grade: 0.8 } },
    buildingStyle: 'queyras',
    biomes: { valley: 1350, forest: 2050, alpage: 2200, rock: 'dolomie', trees: 'meleze' },
    pois: [
      { name: 'Guillestre', type: 'village', at: [44.65880, 6.64900] },
      { name: 'Arvieux', type: 'village', at: [44.76811, 6.73927] },
      { name: 'La Chalp', type: 'village', at: [44.78108, 6.73777] },
      { name: 'Brunissard', type: 'village', at: [44.79352, 6.72940] },
      { name: 'Monument Coppi - Bobet', type: 'stele', at: [44.81132, 6.73687] },
      { name: 'Obélisque du Col d\'Izoard', type: 'stele', at: [44.81964, 6.73461] },
    ],
    segments: [
      { name: "Montée de l'Izoard", from: 'foot', to: 'end' },
      { name: 'Guillestre - Arvieux', from: 'foot', to: 'poi:Arvieux' },
      { name: 'Brunissard - Col', from: 'poi:Brunissard', to: 'end' },
      { name: 'Casse Déserte', from: 'poi:Monument Coppi - Bobet', to: 'end' },
    ],
  },
  {
    id: 'madeleine',
    name: 'Col de la Madeleine',
    subtitle: 'Versant sud, depuis La Chambre',
    massif: 'Maurienne',
    via: [
      [45.39268, 6.26538], // Saint-Rémy-de-Maurienne, dans la vallée
      [45.35893, 6.29986], // La Chambre
      [45.43495, 6.37552], // Col de la Madeleine
    ],
    after: [[45.4395, 6.3715]], // descente vers Celliers
    foot: [45.35893, 6.29986],
    official: { lengthKm: 19.3, avgGradePct: 8.0, tolerance: { lengthKm: 1.2, grade: 0.8 } },
    buildingStyle: 'alpes',
    biomes: { valley: 900, forest: 1700, alpage: 2300, rock: 'gris', trees: 'mixte' },
    // Nœuds OpenStreetMap : le village du pied et le col (natural=saddle, ele=1993).
    pois: [
      { name: 'Saint-Rémy-de-Maurienne', type: 'village', at: [45.39268, 6.26538] },
      { name: 'La Chambre', type: 'village', at: [45.35893, 6.29986] },
      { name: 'Col de la Madeleine', type: 'col', at: [45.43495, 6.37552] },
    ],
    segments: [{ name: 'Ascension de la Madeleine', from: 'foot', to: 'end' }],
  },
  {
    id: 'aubisque',
    name: "Col d'Aubisque",
    subtitle: 'Versant ouest, depuis Laruns par Eaux-Bonnes',
    massif: 'Pyrénées',
    via: [
      [43.05484, -0.43295], // Bielle, dans la vallée d'Ossau
      [42.98824, -0.42663], // Laruns
      [42.97658, -0.33979], // Col d'Aubisque
    ],
    after: [[42.9715, -0.3265]], // la route continue vers le Soulor
    footFromEndKm: 16.6, // Laruns est à 16,6 km du col
    official: { lengthKm: 16.6, avgGradePct: 7.2, tolerance: { lengthKm: 1.2, grade: 0.8 } },
    buildingStyle: 'pyrenees',
    biomes: { valley: 850, forest: 1450, alpage: 1600, rock: 'calcaire', trees: 'hetre' },
    // Nœuds OpenStreetMap : le village du pied et le col (natural=saddle, ele=1709).
    pois: [
      { name: 'Bielle', type: 'village', at: [43.05484, -0.43295] },
      { name: 'Laruns', type: 'village', at: [42.98824, -0.42663] },
      { name: 'Eaux-Bonnes', type: 'village', at: [42.97283, -0.39276] },
      { name: 'Gourette', type: 'village', at: [42.95796, -0.33251] },
      { name: "Col d'Aubisque", type: 'col', at: [42.97658, -0.33979] },
    ],
    segments: [{ name: "Ascension de l'Aubisque", from: 'foot', to: 'end' }],
  },
];
