// Lace Forge · Кружевная Кузница — SillyTavern extension loader.
// The app itself is a prebuilt page in dist/, shown in a full-screen same-origin iframe:
// its styles stay isolated from SillyTavern, and it talks to ST through SillyTavern.getContext().

const BASE = new URL('.', import.meta.url);
const VERSION = '1.0.0';
const APP_URL = new URL(`dist/index.html?v=${VERSION}`, BASE).href;
const ID = 'lace-forge';

const ru = () => {
    try {
        const loc = SillyTavern.getContext().getCurrentLocale?.() || localStorage.getItem('language') || navigator.language || '';
        return /^(ru|uk|be|kk)/i.test(loc);
    } catch {
        return false;
    }
};

const L = () =>
    ru()
        ? {
              name: 'Кружевная Кузница',
              open: 'Открыть Кузницу',
              about: 'Пресеты, персонажи, персоны, лорбуки и сюжеты: редактор и генерация через подключение SillyTavern или свой API. Всё загружается из таверны и сохраняется обратно в неё.',
              frame: 'Кружевная Кузница',
          }
        : {
              name: 'Lace Forge',
              open: 'Open the Forge',
              about: 'Presets, characters, personas, lorebooks and plots: an editor and generator that uses the SillyTavern connection or your own API. Load from the tavern and save back into it.',
              frame: 'Lace Forge',
          };

let overlay = null;
let lastFocus = null;

function isOpen() {
    return !!overlay && overlay.classList.contains('open');
}

function build() {
    overlay = document.createElement('div');
    overlay.id = `${ID}-overlay`;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', L().frame);

    const spinner = document.createElement('div');
    spinner.className = `${ID}-loading`;
    spinner.innerHTML = '<i class="fa-solid fa-hammer fa-bounce"></i>';
    overlay.append(spinner);

    const frame = document.createElement('iframe');
    frame.title = L().frame;
    frame.src = APP_URL;
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    frame.addEventListener('load', () => {
        overlay.classList.add('ready');
        if (isOpen()) focusFrame();
    });
    overlay.append(frame);
    document.body.append(overlay);
}

function focusFrame() {
    const frame = overlay?.querySelector('iframe');
    try {
        frame?.contentWindow?.focus();
    } catch {
        /* ignore */
    }
}

function show() {
    if (!overlay) build();
    if (isOpen()) return;
    lastFocus = document.activeElement;
    overlay.classList.add('open');
    document.documentElement.classList.add(`${ID}-lock`);
    // A history entry of our own: the phone's Back button closes the Forge instead of leaving the tavern.
    try {
        history.pushState({ ...(history.state ?? {}), laceForge: true }, '');
    } catch {
        /* ignore */
    }
    focusFrame();
}

function hide() {
    if (!isOpen()) return;
    overlay.classList.remove('open');
    document.documentElement.classList.remove(`${ID}-lock`);
    try {
        lastFocus?.focus?.();
    } catch {
        /* ignore */
    }
}

function close() {
    if (!isOpen()) return;
    if (history.state?.laceForge) history.back(); // popstate hides the overlay
    else hide();
}

window.addEventListener('popstate', () => {
    if (isOpen() && !history.state?.laceForge) hide();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
        e.preventDefault();
        e.stopPropagation();
        close();
    }
}, true);

window.laceForge = {
    version: VERSION,
    open: show,
    close,
    isOpen,
    /** ST's persona helpers live in a module that is not in getContext(); load the page's own instance. */
    async personaApi() {
        const mod = await import(new URL('../../../personas.js', BASE).href);
        return { initPersona: mod.initPersona, getUserAvatars: mod.getUserAvatars };
    },
};

function addMenuButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById(`${ID}-menu`)) return !!menu;
    const item = document.createElement('div');
    item.id = `${ID}-menu`;
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.title = L().open;
    item.innerHTML = '<div class="fa-solid fa-hammer extensionsMenuExtensionButton"></div><span></span>';
    item.querySelector('span').textContent = L().name;
    const go = () => {
        // Let ST close the wand menu first.
        setTimeout(show, 0);
    };
    item.addEventListener('click', go);
    item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            go();
        }
    });
    menu.append(item);
    return true;
}

function addSettings() {
    const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!host || document.getElementById(`${ID}-settings`)) return;
    const t = L();
    const box = document.createElement('div');
    box.id = `${ID}-settings`;
    box.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b></b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <p class="${ID}-about"></p>
                <div class="menu_button menu_button_icon ${ID}-open">
                    <i class="fa-solid fa-hammer"></i>
                    <span></span>
                </div>
            </div>
        </div>`;
    box.querySelector('b').textContent = t.name;
    box.querySelector(`.${ID}-about`).textContent = t.about;
    box.querySelector(`.${ID}-open span`).textContent = t.open;
    box.querySelector(`.${ID}-open`).addEventListener('click', show);
    host.append(box);
}

function addSlashCommand() {
    try {
        const ctx = SillyTavern.getContext();
        const { SlashCommandParser, SlashCommand } = ctx;
        if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps) return;
        SlashCommandParser.addCommandObject(
            SlashCommand.fromProps({
                name: 'laceforge',
                aliases: ['forge'],
                callback: () => {
                    show();
                    return '';
                },
                helpString: 'Opens Lace Forge (Кружевная Кузница).',
            }),
        );
    } catch (e) {
        console.warn('[Lace Forge] slash command not registered', e);
    }
}

function init() {
    addSettings();
    addSlashCommand();
    // The wand menu is built by ST itself; wait for it if it isn't there yet.
    if (!addMenuButton()) {
        let tries = 0;
        const timer = setInterval(() => {
            if (addMenuButton() || ++tries > 40) clearInterval(timer);
        }, 500);
    }
}

if (typeof jQuery === 'function') jQuery(init);
else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
