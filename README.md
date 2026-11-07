# Cols de France

Simulateur de cyclisme sur home trainer. Sept grands cols sur leurs tracés réels, chacun
avec une approche en vallée : Alpe d'Huez, Mont Ventoux, Tourmalet, Galibier, Izoard,
Madeleine, Aubisque.

## Lancer

En ligne, sans rien installer, y compris sur tablette : https://nezzirf.github.io/cols-de-france/

Sous Windows, double-clique sur `Jouer.cmd` : il installe le jeu la première fois puis l'ouvre.

Sinon, dans un terminal (`npm.cmd` si PowerShell bloque `npm`) :

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
| + / − | Monter ou descendre une vitesse virtuelle |

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

## Le menu

L'écran d'accueil a quatre onglets : **Sortie libre**, **Entraînement**, **Garage** et **Historique**. Un petit
engrenage, en haut à droite, ouvre les **Options** (sons et volume, thème clair ou sombre, alertes d'effort, pause
automatique, écran toujours allumé, effacement des données, crédits). En bas, une barre résume ce qui va être lancé
(parcours, séance, vélo) et porte le bouton **Rouler**, toujours en vue. Ce qui ne change pas à chaque sortie (météo,
moment, pente ressentie, peloton, fantômes) reste replié dans « Réglages de la sortie ».

- **Sortie libre** : les grands cols, le Tour des six biomes, et un parcours personnalisé dont on choisit la distance (jusqu'à 100 km) et la pente. C'est une boucle : au sommet, on repart du départ, la sortie ne se termine pas toute seule.
  Il commence toujours par 5 km de plat pour s'échauffer ; sa route et son paysage sont générés, ils
  ne représentent aucun lieu réel.
- **Entraînement** : un créateur de séances par blocs (échauffement, stable, rampe, intervalles,
  récupération), en % de FTP, avec des modèles prêts à l'emploi. Les séances sont gardées dans le
  navigateur. Une séance se roule sur le parcours choisi : le home trainer passe en mode ERG et
  impose la puissance, et la sortie s'arrête à la fin de la séance ou au bout du parcours.
- **Importer une séance** : le bouton « Importer un fichier… » de l'onglet Entraînement (ou un glisser-déposer)
  lit les fichiers `.zwo` (le format de Zwift, que lisent aussi de nombreux sites d'entraînement), `.mrc`
  et `.erg`. Les blocs sont convertis en % de FTP. Ce qui n'a pas d'équivalent est signalé : un bloc
  « roulage libre » devient un palier à 55 %, et les watts d'un `.erg` sans FTP sont convertis avec la tienne.
- **Garage** : le vélo et le maillot. Le maillot n'a aucun effet sur la vitesse.
- **Historique** : toutes les sorties de plus d'une minute, gardées automatiquement dans le navigateur
  (les points seconde par seconde des 20 dernières, le résumé des 300 dernières), avec le cumul
  des sept derniers jours, les meilleures puissances sur 5 s, 1 min, 5 min et 20 min, et la FTP
  estimée (95 % du meilleur effort de 20 minutes). Un clic sur une sortie rouvre son récap.

La FTP, le poids et le nom se règlent en haut de l'écran. Sous le bouton « Rouler » :

- **Météo et moment** : dégagé, nuageux, brouillard ou pluie ; matin, jour ou coucher de soleil. Ils
  changent la lumière, le ciel et la brume, jamais l'effort.
- **Peloton** : quatre coéquipiers de niveaux différents (72, 88, 100 et 112 % de ta FTP) roulent avec
  la même physique que toi, avec l'écart du plus proche devant et derrière. Hors séance guidée.
- **Rouler en peloton** (réglages de la sortie libre) : un groupe de 10 ou 15 coureurs, aux watts par kilo choisis avant le départ, sur le
  parcours que tu as choisi. Chacun a sa masse (58 à 85 kg) et son niveau à ± 2 % ; ils roulent avec la même
  physique que toi. Pendant les 15 minutes d'échauffement, le groupe reste avec toi, à ta vitesse, quel que
  soit ton rythme ; il se cale ensuite sur le niveau choisi et le tient jusqu'à la fin : si tu vas moins
  vite, il part devant ; si tu vas plus vite, tu le doubles. L'écran indique le niveau, l'échauffement restant et combien de
  coureurs sont devant et derrière. Le groupe ne reprend pas après une coupure (reprise de sortie) et
  ne fait pas d'abri du vent.
- **Fantôme de ma meilleure sortie** : sur un col, un cycliste translucide rejoue ta sortie la plus
  rapide sur ce parcours, tant qu'aucun record de segment ne prend le relais.
- **Fantômes** : à droite du menu, « + Ajouter » fait rouler jusqu'à cinq coureurs virtuels, chacun à
  ses watts par kilo réglés avant la sortie. Ils ont ton vélo et ton poids, partent avec toi et tiennent
  leur niveau jusqu'à la fin, quoi que tu fasses. Chacun est translucide, d'une teinte différente ; l'écran
  donne le plus proche devant et le plus proche derrière. Ils ne reprennent pas après une coupure.

- **Sons d'ambiance** : fabriqués en direct par le navigateur, sans fichier. Vagues et mouettes à la plage, oiseaux et
  feuilles en forêt, vent et sifflements en montagne, au canyon et au désert ; en prairie, des oiseaux et, rarement,
  quelques grillons. Les sons se fondent d'un milieu à l'autre ; le souffle du vent suit la vitesse, la pluie suit la
  météo. Case « Sons d'ambiance » dans le menu, touche M pendant la sortie.
- **Troupeaux** : dans les prairies du monde d'entraînement, des vaches et des moutons paissent à côté de la route,
  toujours aux mêmes endroits, à plus d'un kilomètre les uns des autres. En passant devant, on les entend meugler ou
  bêler, plus fort à mesure qu'on s'approche, du côté où ils se trouvent. Le bêlement est un enregistrement de mouton (les trois premières secondes
  de `public/sounds/mouton.mp3`, fourni par le joueur, dont la licence n'est pas connue) ; le meuglement est synthétisé.
- **Météo variable et heure réelle** : dans le menu, « Météo : Variable » fait changer le temps pendant la sortie
  (éclaircies, nuages, brouillard, pluie qui monte et retombe en douceur ; la même journée donne toujours le même ciel).
  « Moment : Heure réelle » suit ta montre : matin, plein jour, coucher de soleil, puis nuit avec lune et étoiles. « Nuit »
  se choisit aussi seule.
- **Public des grands cols** : sur les quatre derniers kilomètres d'un vrai col, des spectateurs bordent la route, de plus en
  plus serrés vers le sommet, certains bras en l'air et qui sautent à ton passage ; banderoles, arches de la flamme rouge à
  1 km et 500 m, rumeur de foule, applaudissements et cloches de vache dans le son.
- **Villages et ponts** : aboiements au loin dans les villages, trois coups de cloche en passant devant une église. Les
  ponts viennent d'OpenStreetMap (`scripts/build-structures.mjs`, résultat dans `structures.json` de chaque col) :
  parapets de pierre et torrent qu'on entend en dessous. Les tunnels du fichier ne sont pas représentés.
- **Test FTP 20 min** : dans les séances proposées. Échauffement, trois accélérations, un effort de cinq minutes, puis vingt
  minutes d'**effort libre** pendant lesquelles le home trainer ne t'impose rien (pente fixe de 4 %) : à toi de tenir la
  puissance la plus haute possible. Le récap en déduit ta FTP (95 % de ta meilleure puissance sur 20 min) et propose de
  l'appliquer.

## Pendant la sortie

- **Verrouiller les watts** (hors séance) : le bouton « Verrouiller les watts » (touche L, ou Y sur la manette
  de droite du Zwift Play) fige la puissance à celle du moment : le home trainer passe en ERG et la pente
  n'agit plus. Une fois verrouillé, ↑ et ↓ (ou la flèche du haut et celle du bas de la manette de gauche)
  montent ou descendent d'un watt, et un second appui libère. Pas de verrouillage pendant une séance, qui
  impose déjà sa puissance.
- **Zones de puissance** : la puissance prend la couleur de sa zone (modèle de Coggan, de Z1 à Z7, en
  % de la FTP) ; le récap donne le temps passé dans chacune.
- **Pause automatique** : si tu t'arrêtes de pédaler et que le vélo s'arrête (moins de 5 km/h), le
  chrono et l'enregistrement s'arrêtent après 3 s, et repartent au premier coup de pédale.
- **Alertes d'effort** : un message si tu tiens plus de 110 % de ta FTP pendant 2 minutes, ou si la
  cadence reste sous 60 tr/min pendant 20 secondes. Pas d'alerte de puissance pendant une séance guidée.
- **Reprise** : la sortie est sauvegardée toutes les 30 secondes (et quand tu quittes avec Échap).
  Après une coupure, le menu propose de la reprendre, de la terminer pour voir son récap, ou de
  l'abandonner.
- **Récap** : courbe de puissance, cardio et relief que l'on survole pour lire les valeurs et que l'on
  zoome en glissant dessus (ou avec + et −) ; les moyennes de la portion visible s'affichent dessous.
  Le fichier .tcx se télécharge, et se partage directement vers une autre application là où le
  navigateur le permet (tablette, téléphone).

## Le monde d'entraînement

Une boucle imaginaire de 46 km, de la plage au désert, qui traverse six biomes : plage et mer,
prairies fleuries, forêt, montagne enneigée, canyon rouge et désert de dunes. Elle sert aux séances
(onglet Entraînement) et peut aussi se rouler librement depuis l'onglet Sortie libre.

**Une boucle sans fin.** Le décor est périodique : la fin du tour et son début sont identiques (route,
altitude, relief, biomes, végétation), si bien qu'on enchaîne les tours sans voir le raccord. Le
départ est au milieu de la plage, là où le décor est le plus simple. L'écran compte tous les tours
(« Parcourus ») et la distance avant le suivant ; chaque tour est chronométré comme un segment.

Aucune frontière nette : chaque biome a un poids qui varie sans à-coup sur 1,4 km de part et
d'autre de la limite (`src/sim/worldBiomes.ts`). Ce poids règle tout à la fois le relief
(`src/sim/worldRoute.ts`), la couleur du sol (`src/world/worldGround.ts`), la brume, et le choix
de ce qui pousse à chaque endroit (`src/world/vegetation.ts`), tiré au sort cellule par cellule,
d'où des lisières mêlées plutôt qu'un fondu uniforme. La mer (`src/world/water.ts`) tire sa couleur
de la profondeur, avec écume le long du rivage. Tout est généré : aucun lieu réel.

## Rouler devant une série ou un film

Dans l'onglet Entraînement, « Où rouler la séance ? » propose une troisième option, **Application en
fond**. Le jeu n'affiche alors aucun décor : seulement des barres minimales avec la puissance (en
vert quand tu tiens la cible), la cible, la cadence, le cardio, la vitesse, le temps du bloc et le
déroulé de la séance. La route sous-jacente est une boucle plate de 12 km (`src/sim/salonRoute.ts`).
Elle marche avec une séance (le home trainer tient la puissance, idéal pour un bloc stable) comme sans :
en « Sortie libre », tu pédales comme tu veux. Le lieu choisi dans l'onglet Entraînement s'applique à
toute sortie lancée depuis cet onglet.

- **Capturer l'application dans la page** : le navigateur te demande quelle fenêtre ou quel onglet
  afficher. L'image prend l'espace entre les barres, qui peuvent être en haut, en bas, ou les deux :
  rien n'est posé sur le film. Pour un onglet, coche « Partager aussi l'audio de l'onglet » : le jeu
  rejoue le son et l'onglet d'origine se tait. Diffuser ensuite l'onglet du jeu sur une télé (clic droit,
  « Diffuser… ») emmène l'image et le son. Une fenêtre, elle, se capture sans son.
- **Barre flottante** (Chrome ou Edge sur ordinateur) : une petite fenêtre qui reste au-dessus de
  toutes les autres, même d'une vidéo en plein écran. Tu ouvres ton application à côté et tu glisses
  la barre en haut ou en bas.
- **Écran partagé** (tablette) : ni la capture ni la barre flottante n'existent sur tablette. Ouvre ton
  application, puis place le jeu à côté d'elle avec l'écran partagé du système ; le jeu n'affiche que
  le panneau de la sortie, en gros, avec un bouton « Terminer la sortie ». Il est proposé d'office sur
  tablette.
- **Pastille flottante** (Android, Chrome) : les chiffres sont dessinés sur un canvas, diffusé dans la
  mini-fenêtre vidéo « image dans l'image » du navigateur, qui reste par-dessus les autres applications.
  Lance la sortie, ouvre Netflix en plein écran, puis déplace ou agrandis la pastille avec les doigts.
  Fermer la pastille ne coupe pas la sortie : un bouton du jeu la rouvre. Il faut laisser le jeu ouvert
  en arrière-plan.

Limites : Netflix, Disney+ et d'autres services protégés par DRM s'affichent souvent en noir dans une
capture, ce que le jeu ne peut pas contourner ; la barre flottante et la pastille sont faites pour ce
cas. Rien de cela n'a été essayé avec Netflix ; la barre flottante n'a pas pu être testée de bout en
bout, et la pastille n'a été essayée que sur ordinateur (ouverture et dessin), pas sur Android, où
reste à confirmer que le jeu et le Bluetooth continuent en arrière-plan.

## Choisir son vélo

Le garage propose des vélos sans équipe (route, endurance, contre-la-montre, gravel, VTT, ville) et
tous les vélos des 18 équipes WorldTour masculines 2026, avec leurs couleurs. Le vélo change le
poids, l'aérodynamique et la résistance au roulement : la vitesse à l'écran, et la résistance
envoyée au home trainer. Le catalogue est dans `src/sim/bikes.ts`.

Chaque vélo a sa silhouette (`src/sim/bikeDesigns.ts`) : profondeur des tubes, cadre plongeant,
haubans, potence, jantes, peinture. Elle est relevée d'après l'allure des cadres : les fabricants ne
publient pas de modèles 3D, ce sont des ressemblances et non des copies exactes.

Ces valeurs sont typiques par catégorie (aéro, grimpeur, polyvalent, contre-la-montre…), car les
marques ne publient pas de mesures comparables : un Cervélo S5 et un Canyon Aeroad se valent ici.
Les modèles viennent de guides parus en janvier 2026 et peuvent avoir changé en cours de saison.

## Vitesses virtuelles (Zwift Cog et Zwift Play)

Avec un pignon fixe, la chaîne ne bouge pas : le jeu envoie au home trainer la pente qui reproduit la
force du rapport choisi, à la même cadence. Il y a 24 rapports (`src/sim/gears.ts`). La vitesse à
l'écran vient de la puissance réelle, comme d'habitude. Les vitesses sont inactives pendant une
séance, puisque le home trainer impose alors la puissance.

Clique sur **Zwift Play** dans le menu : un bouton de vitesse pressé s'affiche sous « Rouler ». En
firmware 1, chaque manette se connecte à part : reclique pour la deuxième. Le bouton droit monte une
vitesse, le gauche la descend. Les touches + et − font la même chose et activent aussi les vitesses.

Le bouton Y de la manette de droite et les flèches haut et bas de celle de gauche règlent les watts verrouillés (voir « Pendant la sortie »). Leur lecture n'a pas été vérifiée sur une vraie manette.

Zwift ne publie pas ce protocole : `src/hardware/zwiftPlay.ts` s'appuie sur le projet libre
BikeControl et sur des analyses indépendantes, et une mise à jour de firmware pourrait le casser.

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
| Madeleine (depuis La Chambre) | 19,5 km à 7,8 % | 19,3 km à 8,0 % |
| Aubisque (depuis Laruns) | 16,6 km à 7,1 % | 16,6 km à 7,2 % |

La longueur de l'Alpe, du Galibier et de l'Aubisque sert à placer leur pied, seule leur pente
est donc un résultat indépendant. Les chiffres officiels de la Madeleine et de l'Aubisque
viennent de sites de cols cyclistes qui ne s'accordent pas à 0,3 km près : la comparaison vaut
ce qu'elles valent. Sur l'Aubisque, deux lacets à pente douce (vers les kilomètres 15,1 et 21,9
du tracé) sont reconnus comme des demi-tours d'un seul tenant et non comme des boucles ; je ne
les ai pas recoupés sur une carte.

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
