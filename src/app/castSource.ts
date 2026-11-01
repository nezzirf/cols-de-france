// Ce que le jeu affiche pendant que l'on regarde autre chose : la capture d'une autre fenêtre ou d'un
// onglet, ou une barre qui flotte par-dessus toutes les fenêtres. Les deux demandent un geste du joueur.

/**
 * Demande au navigateur de capturer une fenêtre ou un onglet, au choix du joueur. Seule l'image est
 * prise : le son reste celui de l'application d'origine, sans écho.
 */
export async function startCapture(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Ce navigateur ne sait pas capturer une application : utilise Chrome ou Edge sur ordinateur, ou l’écran partagé.');
  }
  // Les options propres à Chrome sont ignorées ailleurs : l'écran entier est exclu, car il contiendrait le jeu lui-même.
  const options = { video: { frameRate: { ideal: 30 } }, audio: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', monitorTypeSurfaces: 'exclude' };
  try {
    return await navigator.mediaDevices.getDisplayMedia(options as DisplayMediaStreamOptions);
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
      throw new Error('Aucune application choisie : choisis une fenêtre ou un onglet à afficher.');
    }
    throw err;
  }
}

/** Ce que ce navigateur sait faire : une tablette ne capture pas d'application et n'a pas de barre flottante. */
export function castSupport(): { capture: boolean; floating: boolean } {
  return { capture: !!navigator.mediaDevices?.getDisplayMedia && !isTouchDevice(), floating: floatingBarSupported() };
}

/** Les navigateurs de tablette peuvent annoncer getDisplayMedia sans le proposer vraiment : on s'en tient au tactile. */
function isTouchDevice(): boolean {
  return navigator.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches;
}

interface DocumentPictureInPicture {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

export function floatingBarSupported(): boolean {
  return 'documentPictureInPicture' in window;
}

/**
 * Ouvre une petite fenêtre qui reste au-dessus des autres, y compris d'une vidéo en plein écran. Le
 * navigateur la place lui-même ; le joueur la glisse en haut ou en bas de son écran.
 */
export async function openFloatingBar(width: number, height: number): Promise<Window> {
  if (!floatingBarSupported()) {
    throw new Error('La barre flottante demande Chrome ou Edge sur ordinateur. Essaie plutôt « Capturer l’application ».');
  }
  const api = (window as unknown as { documentPictureInPicture: DocumentPictureInPicture }).documentPictureInPicture;
  let win: Window;
  try {
    win = await api.requestWindow({ width, height });
  } catch (err) {
    const reason = err instanceof DOMException && err.name === 'NotAllowedError' ? 'le navigateur veut un clic récent' : 'le navigateur a refusé';
    throw new Error(`La barre flottante n'a pas pu s'ouvrir (${reason}). Essaie « Capturer l'application dans la page ».`);
  }
  // La nouvelle fenêtre est vierge : elle reprend les styles du jeu.
  for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
    const copy = node.cloneNode(true) as HTMLElement;
    if (copy instanceof HTMLLinkElement) copy.href = (node as HTMLLinkElement).href;
    win.document.head.appendChild(copy);
  }
  win.document.body.style.margin = '0';
  win.document.body.style.background = '#0b0d10';
  return win;
}

/**
 * Garde le jeu à pleine vitesse quand sa fenêtre passe au second plan : un navigateur ralentit les
 * pages cachées, sauf celles qui tiennent un verrou. Rend de quoi le relâcher.
 */
export function keepAwake(): () => void {
  let release = () => {};
  const locks = navigator.locks;
  if (locks) {
    void locks.request('cols-de-france-ride', () => new Promise<void>((resolve) => (release = resolve)));
  }
  return () => release();
}
