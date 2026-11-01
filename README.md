# Cols de France

Simulateur de cyclisme sur home trainer. Cinq grands cols sur leurs tracés réels, chacun
avec une approche en vallée : Alpe d'Huez, Mont Ventoux, Tourmalet, Galibier, Izoard.

## Lancer

```bash
npm install
npm run dev
```

Ouvrir http://localhost:5183 dans **Chrome ou Edge**. Web Bluetooth et WebUSB n'existent pas
dans Firefox ni Safari, et exigent `localhost` ou HTTPS.

Sans home trainer, « Rouler » démarre le mode démo.

| Touche | Action |
| --- | --- |
| ↑ / ↓ | Puissance ±10 W, ±50 W avec Maj (mode démo) |
| P | Pause |
| V | Caméra poursuite / embarquée |

En mode démo, tu peux aussi explorer librement, sans influence sur les records (ils sont coupés
pour la sortie dès la première utilisation) :

| Commande | Action |
| --- | --- |
| Barre en bas de l'écran | Sauter à n'importe quel point du parcours |
| Pg↑ / Pg↓ | Avancer ou reculer de 1 km |
| F | Caméra libre, le temps s'arrête |
| Z Q S D | Se déplacer (W A S D sur clavier QWERTY) |
| Clic maintenu + souris | Regarder |
| A / E | Descendre / monter (Q / E sur clavier QWERTY) |
| Maj, molette | Aller plus vite, régler la vitesse |
| T | Poser le cycliste sur la route la plus proche |

La position exacte (kilomètre, altitude, coordonnées GPS) s'affiche sous la barre.
| Échap | Quitter |

## Choisir son vélo

Le menu propose des vélos sans équipe (route, endurance, contre-la-montre, gravel, VTT, ville) et
tous les vélos des 18 équipes WorldTour masculines 2026, avec leurs couleurs. Le vélo change le
poids, l'aérodynamique et la résistance au roulement : la vitesse à l'écran, et la résistance
envoyée au home trainer. Le catalogue est dans `src/sim/bikes.ts`.

Chaque vélo a sa silhouette (`src/sim/bikeDesigns.ts`) : profondeur des tubes, cadre plongeant,
haubans, potence, jantes, peinture. Elle est relevée d'après l'allure des cadres : les fabricants ne
publient pas de modèles 3D, ce sont des ressemblances et non des copies exactes.

Ces valeurs sont typiques par catégorie (aéro, grimpeur, polyvalent, contre-la-montre…), car les
marques ne publient pas de mesures comparables : un Cervélo S5 et un Canyon Aeroad se valent ici.
Les modèles viennent de guides parus en janvier 2026 et peuvent avoir changé en cours de saison.

## Connecter le KICKR Core

**Bluetooth (recommandé).** « Connecter le KICKR Core (Bluetooth) », puis choisir l'appareil.
Le jeu utilise FTMS, et se rabat sur l'extension Wahoo du service Cycling Power si le firmware
n'expose pas FTMS. Fermer Zwift et l'application Wahoo avant : le KICKR n'accepte qu'un seul
contrôleur à la fois.

**ANT+ FE-C.** Il faut une clé USB ANT+. Sous Windows, Chrome ne peut l'ouvrir que si elle
utilise le pilote WinUSB : l'installer avec [Zadig](https://zadig.akeo.ie/) (cela la rend
indisponible pour les logiciels qui attendent le pilote Garmin, jusqu'à réinstallation de
celui-ci).

## Ce que simule la physique

`src/sim/physicsEngine.ts` intègre (RK4, pas de 10 ms) l'équation du mouvement :

- gravité selon le sinus de la pente exacte, avec g variant selon latitude et altitude ;
- roulement, paliers ;
- traînée selon la densité de l'air en atmosphère standard, donc selon l'altitude ;
- inertie : masse cycliste + vélo + inertie de rotation des roues.

La vitesse à l'écran est celle de cette simulation, calculée depuis la puissance mesurée par
le home trainer. Le frein reçoit chaque seconde la pente, le Crr et ρ·CdA à l'altitude courante.

Limites à connaître :

- Le KICKR Core simule au maximum 16 % ; au-delà la résistance plafonne.
- FTMS ne transporte pas le poids : le frein n'en tient pas compte en Bluetooth, alors que la
  vitesse à l'écran, si. En ANT+ et en mode Wahoo, le poids est envoyé.
- « Pente ressentie » réduit ce que sent le cycliste, pas la vitesse simulée.
- L'altitude agit sur l'air, pas sur la physiologie du cycliste.

## Données

Tout vient de sources réelles, reconstruites par `npm run routes` (`-- ventoux` pour un seul col) :

| Donnée | Source |
| --- | --- |
| Géométrie de la route | OpenStreetMap, via le routeur OSRM |
| Altitude de la route | IGN RGE ALTI, Géoplateforme |
| Relief 3D | Mapzen Terrain Tiles (z13), grille de 20 m |
| Repères | Nœuds OpenStreetMap, coordonnées dans `scripts/route-defs.mjs` |
| Bâtiments | IGN BD TOPO : emprise, hauteur des murs et du toit, nature |
| Paysage | Photos aériennes IGN BD ORTHO : couleur du terrain et emplacement des forêts |

Vérification avec les chiffres officiels, à partir du pied du col :

| Col | Calculé | Officiel |
| --- | --- | --- |
| Alpe d'Huez | 13,8 km à 8,1 % | 13,8 km à 8,1 % |
| Mont Ventoux | 21,9 km à 7,2 % | 21,5 km à 7,5 % |
| Tourmalet | 17,6 km à 7,1 % | 17,2 km à 7,4 % |
| Galibier | 34,8 km à 5,4 % | 34,8 km à 5,5 % |
| Izoard | 31,3 km à 4,4 % | 31,5 km à 4,3 % |

La longueur de l'Alpe et du Galibier sert à placer leur pied, seule leur pente est donc un
résultat indépendant.

Ce qui est calculé plutôt qu'observé :

- **Bornes kilométriques** : placées à chaque kilomètre depuis le sommet, avec la pente mesurée
  sur le profil. Leur emplacement peut différer de quelques mètres des vraies bornes.
- **Rendu** : réaliste, avec lumière physique et reflets du ciel. La définition baisse seule si la
  machine descend sous 42 images/s.
- **Épingles** : OSM les décrit par deux jambes collées, en pointe. Elles sont évasées à 9 m de
  rayon, ce qui déplace la route de 4 à 8 m au sommet des virages. Le tracé reste réel ailleurs.
- **Lacets de l'Alpe** : détectés par géométrie, numérotés de 21 à 1 depuis le bas. Les noms
  viennent d'OpenStreetMap, mais la numérotation n'a pas pu être recoupée panneau par panneau.
- **Profil** : filtré pour retirer les erreurs du modèle de terrain (tunnels, gorges, versants
  raides). Les pentes sont fiables sur 100 m environ, pas au mètre ; elles sont bornées à 14,5 %.
- **Bâtiments** : tous ceux à moins de 500 m de la route, à leur emplacement et à leur taille
  réels (emprise au sol, hauteur des murs, hauteur du toit mesurée quand l'IGN la donne). Les
  couleurs, fenêtres et formes de toit sont en revanche génériques, choisies par région. Quelques
  bâtiments sont décalés de 5 m au plus quand le tracé OSM et l'emprise IGN se chevauchent, et
  ceux à cheval sur la route ne sont pas posés.
- **Parois rocheuses** : le relief mondial (30 m) et l'altitude IGN de la route divergent de 12 m
  sur 10 % du tracé, et jusqu'à 85 m. Une paroi avec strates et rochers rattrape l'écart : elle n'existe
  pas forcément à cet endroit dans la réalité.
- **Végétation** : les forêts sont là où la photo aérienne en montre, à 8 m près, mais chaque arbre
  est généré. Le relief, lui, est réel.
- **Murets de virage** : ajoutés dans les virages serrés pour le décor, ils ne suivent pas les vrais.

Le monument Pantani au Galibier n'est pas représenté : il n'a pas été trouvé sur OpenStreetMap,
et aucun repère n'est placé sans coordonnées vérifiables.

## Ajouter un col

Ajouter une entrée à `scripts/route-defs.mjs` (points de passage, pied du col, chiffres
officiels, repères, segments), puis `npm run routes -- <id>`. Le script signale tout écart avec
les chiffres officiels. `route.gpx` est produit pour chaque col.

## Architecture

```
scripts/        Construction des données depuis les sources réelles
public/data/    Parcours prêts à l'emploi (route.json, route.gpx, terrain.bin, buildings.json)
src/sim/        physicsEngine, route, segments (PR et ghost), gradeColor (blanc → noir)
src/hardware/   ftmsProtocol, kickrBluetooth, antProtocol, antUsb, heartRate, demoTrainer
src/world/      Scène Three.js : terrain, route, végétation, repères, cycliste, biomes
src/hud/        HUD haut gauche / milieu / droite, profil du prochain kilomètre
src/app/game.ts Boucle de jeu
```

Les protocoles sont des fonctions pures, testées sans matériel :

```bash
npm test
```

Les records sont dans le `localStorage` du navigateur, donc propres à ce navigateur.

## Licences

Tracés © contributeurs OpenStreetMap (ODbL). Altitudes et bâtiments IGN (Licence Ouverte Etalab).
La clé réseau ANT+ dans `src/hardware/antProtocol.ts` relève de la licence d'adoptant ANT+,
ce qui compte si le projet est un jour distribué.
