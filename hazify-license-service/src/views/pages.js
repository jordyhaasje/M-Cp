function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shell({ title, body, extraHead = "" }) {
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #f5f5f7;
      --bg-2: #eef1f5;
      --surface: rgba(255,255,255,0.86);
      --surface-solid: #ffffff;
      --line: #d8dee7;
      --line-soft: #e6ebf2;
      --text: #0f172a;
      --muted: #546074;
      --subtle: #708097;
      --brand: #111111;
      --brand-contrast: #ffffff;
      --ok: #0f7a4e;
      --warn: #8e6200;
      --danger: #b42318;
      --radius-2xl: 34px;
      --radius-xl: 24px;
      --radius-lg: 18px;
      --radius-md: 14px;
      --shadow-page: 0 18px 48px rgba(15, 23, 42, 0.09);
      --shadow-card: 0 14px 30px rgba(15, 23, 42, 0.07);
      --shadow-hover: 0 20px 36px rgba(15, 23, 42, 0.12);
      --font-main: "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: "SF Mono", Menlo, Consolas, monospace;
    }

    * { box-sizing: border-box; }
    html, body { min-height: 100%; }

    body {
      margin: 0;
      font-family: var(--font-main);
      color: var(--text);
      background:
        radial-gradient(980px 400px at 110% -10%, rgba(15, 23, 42, 0.08), transparent 68%),
        radial-gradient(760px 400px at -18% 105%, rgba(70, 84, 110, 0.11), transparent 70%),
        linear-gradient(180deg, #fbfbfc 0%, var(--bg) 100%);
      letter-spacing: -0.01em;
      line-height: 1.45;
    }

    .page {
      width: min(1140px, calc(100% - 34px));
      margin: 16px auto 30px;
    }

    .glass {
      border: 1px solid rgba(255,255,255,.95);
      background: var(--surface);
      backdrop-filter: blur(12px);
      box-shadow: var(--shadow-page);
      border-radius: var(--radius-2xl);
    }

    .topbar {
      padding: 4px 0 12px;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 64px;
    }

    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }

    .brandmark-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      border: 0;
      background: transparent;
    }

    .brandmark {
      width: 64px;
      height: 64px;
      border-radius: 0;
      border: 0;
      background: transparent;
      object-fit: contain;
      box-shadow: none;
      flex-shrink: 0;
      transition: transform .2s ease, filter .2s ease, opacity .2s ease;
    }

    .brandmark-link:hover .brandmark {
      transform: translateY(-2px) scale(1.05);
      filter: drop-shadow(0 12px 18px rgba(15, 23, 42, 0.16));
      opacity: 1;
    }

    .section {
      border: 1px solid #d9e0e9;
      border-radius: var(--radius-2xl);
      background: var(--surface-solid);
      box-shadow: var(--shadow-card);
      overflow: hidden;
    }

    .hero {
      padding: clamp(22px, 3.6vw, 34px);
      border-bottom: 1px solid var(--line-soft);
      background:
        radial-gradient(620px 220px at 100% 0%, rgba(15, 23, 42, 0.05), transparent 68%),
        linear-gradient(160deg, #ffffff 0%, #fafbfc 64%, #f7f8fa 100%);
      display: grid;
      gap: 18px;
    }

    .hero-mark {
      width: 38px;
      height: 38px;
      object-fit: contain;
      opacity: .92;
    }

    .eyebrow {
      margin: 0;
      color: #5a6679;
      text-transform: uppercase;
      letter-spacing: .14em;
      font-size: .75rem;
      font-weight: 700;
    }

    .hero h2 {
      margin: 6px 0 6px;
      max-width: 13ch;
      font-size: clamp(1.68rem, 3.35vw, 2.66rem);
      line-height: 0.98;
      letter-spacing: -.045em;
      color: #0f172a;
    }

    .lead {
      margin: 0;
      max-width: 62ch;
      color: var(--muted);
      font-size: clamp(.9rem, 1.02vw, 1rem);
      line-height: 1.55;
    }

    .brand-ribbon {
      margin-top: 10px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      min-height: 48px;
    }

    .brand-ribbon img {
      width: 28px;
      height: 28px;
      object-fit: contain;
      opacity: .8;
      filter: saturate(1.04) contrast(1.02);
      animation: floatBrand 6.4s ease-in-out infinite;
      transform: translateY(0);
    }

    .brand-ribbon img:nth-child(2) { animation-delay: .25s; }
    .brand-ribbon img:nth-child(3) { animation-delay: .45s; }
    .brand-ribbon img:nth-child(4) { animation-delay: .65s; }
    .brand-ribbon img:nth-child(5) { animation-delay: .85s; }
    .brand-ribbon img:nth-child(6) { animation-delay: 1.05s; }
    .brand-ribbon img:nth-child(7) { animation-delay: 1.25s; }

    .brand-ribbon img.chatgpt-focus {
      opacity: 1;
      filter: drop-shadow(0 6px 14px rgba(15, 23, 42, 0.18));
      animation: chatgptPulse 4.2s ease-in-out infinite;
    }

    @keyframes floatBrand {
      0%, 100% { transform: translateY(0); opacity: .78; }
      50% { transform: translateY(-4px); opacity: 1; }
    }

    @keyframes chatgptPulse {
      0%, 100% {
        transform: translateY(0) scale(1);
      }
      35% {
        transform: translateY(-3px) scale(1.06);
      }
      70% {
        transform: translateY(0) scale(1.02);
      }
    }

    .content {
      padding: 16px;
      display: grid;
      gap: 14px;
    }

    .cards-2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .start-card {
      min-height: 176px;
      border: 1px solid #dee5ef;
      border-radius: var(--radius-xl);
      background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
      padding: 20px;
      display: grid;
      align-content: start;
      gap: 13px;
      box-shadow: 0 8px 20px rgba(17, 24, 39, 0.06);
      transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
    }

    .start-card:hover {
      transform: translateY(-2px);
      border-color: #cbd4e2;
      box-shadow: var(--shadow-hover);
    }

    .start-card h3 {
      margin: 0;
      font-size: clamp(1.08rem, 1.5vw, 1.24rem);
      letter-spacing: -.02em;
    }

    .start-card p {
      margin: 0;
      color: var(--muted);
      max-width: 35ch;
      font-size: .92rem;
      line-height: 1.54;
    }

    .btn-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .btn {
      min-height: 38px;
      border-radius: 11px;
      border: 1px solid #d0d9e6;
      background: #fff;
      color: #1f2d44;
      font: inherit;
      font-size: .82rem;
      font-weight: 700;
      padding: 9px 14px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform .14s ease, box-shadow .14s ease, border-color .14s ease;
    }

    .btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 20px rgba(15, 23, 42, 0.09);
      border-color: #c2ccdc;
    }

    .btn.primary {
      background: var(--brand);
      border-color: var(--brand);
      color: var(--brand-contrast);
    }

    .btn.soft { background: #f4f7fb; }

    .btn:disabled {
      opacity: .58;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .notice {
      border: 1px solid #dde5ef;
      border-radius: 12px;
      background: #f8fbff;
      color: #45566e;
      padding: 10px 12px;
      font-size: .92rem;
    }

    .notice.ok {
      background: #effcf5;
      border-color: rgba(15,122,78,.36);
      color: #0f7148;
    }

    .notice.warn {
      background: #fff8ea;
      border-color: rgba(142,98,0,.35);
      color: #7f5700;
    }

    .notice.err {
      background: #fff2f2;
      border-color: rgba(180,35,24,.34);
      color: #971e14;
    }

    .panel {
      border: 1px solid #dfe6ef;
      border-radius: var(--radius-xl);
      background: #fff;
      padding: 14px;
      display: grid;
      gap: 12px;
    }

    .panel h3 {
      margin: 0;
      font-size: .93rem;
      letter-spacing: -.012em;
    }

    .panel p {
      margin: 0;
      color: var(--muted);
      font-size: .82rem;
      line-height: 1.52;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0,1fr));
      gap: 10px;
    }

    .field {
      display: grid;
      gap: 6px;
    }

    .field.full { grid-column: 1 / -1; }

    label {
      font-size: .84rem;
      font-weight: 700;
      color: #33445c;
    }

    input, select {
      width: 100%;
      min-height: 42px;
      border: 1px solid #d2dbe9;
      border-radius: 12px;
      background: #fff;
      padding: 11px 12px;
      font: inherit;
      color: var(--text);
    }

    input:focus, select:focus {
      outline: 2px solid rgba(17,24,39,.14);
      outline-offset: 1px;
      border-color: #93a4bc;
    }

    .helper {
      margin: 0;
      font-size: .78rem;
      color: #6d7d94;
    }

    .connect-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0,1fr));
      gap: 10px;
    }

    .connect-card {
      border: 1px solid #dce4ef;
      border-radius: 16px;
      background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
      min-height: 132px;
      padding: 12px;
      display: grid;
      align-content: space-between;
      justify-items: center;
      gap: 14px;
      transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
    }

    .connect-card:hover {
      transform: translateY(-2px);
      border-color: #c8d3e3;
      box-shadow: 0 14px 24px rgba(15, 23, 42, 0.09);
    }

    .connect-card.active {
      border-color: #0f172a;
      box-shadow: 0 14px 24px rgba(15, 23, 42, 0.14);
    }

    .connect-icon-wrap {
      width: 42px;
      height: 42px;
      border-radius: 14px;
      display: grid;
      place-items: center;
      background: linear-gradient(180deg, #ffffff 0%, #f7f9fc 100%);
      border: 1px solid #dce4ef;
      box-shadow: inset 0 1px 0 #fff;
    }

    .connect-icon-wrap img {
      width: 22px;
      height: 22px;
      object-fit: contain;
    }

    .connect-card h4 {
      margin: 0;
      font-size: .78rem;
      text-align: center;
      line-height: 1.25;
      letter-spacing: -.01em;
    }

    .hero-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .store-list {
      display: grid;
      gap: 8px;
      margin-top: 4px;
    }

    .store-item {
      width: 100%;
      border: 1px solid #dbe3ee;
      border-radius: 12px;
      background: #fff;
      padding: 10px 11px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      text-align: left;
      cursor: pointer;
      transition: border-color .14s ease, box-shadow .14s ease;
    }

    .store-item:hover {
      border-color: #bcc9dc;
      box-shadow: 0 10px 18px rgba(15, 23, 42, 0.08);
    }

    .store-item.active {
      border-color: #0f172a;
      box-shadow: 0 12px 20px rgba(15, 23, 42, 0.12);
    }

    .store-item strong {
      display: block;
      font-size: .82rem;
      line-height: 1.2;
      color: #1c2b41;
    }

    .store-item span {
      display: block;
      color: #677790;
      font-size: .73rem;
      line-height: 1.35;
      margin-top: 3px;
    }

    .store-pill {
      min-width: 52px;
      border-radius: 999px;
      border: 1px solid #d7e0ed;
      background: #f6f8fc;
      padding: 5px 8px;
      text-align: center;
      font-size: .71rem;
      color: #4b5b73;
      white-space: nowrap;
    }

    .mini-note {
      margin: 0;
      font-size: .75rem;
      color: #667994;
      line-height: 1.45;
    }

    .connection-list {
      display: grid;
      gap: 8px;
    }

    .connection-item {
      border: 1px solid #dce4ef;
      border-radius: 12px;
      padding: 9px 10px;
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .connection-item strong {
      font-size: .8rem;
      color: #1c2b41;
    }

    .connection-item span {
      font-size: .72rem;
      color: #64748c;
      white-space: nowrap;
    }

    .social-footer {
      margin-top: 16px;
      display: flex;
      justify-content: center;
    }

    .discord-logo-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      border: 0;
      background: transparent;
    }

    .discord-logo-link:focus-visible {
      outline: 2px solid #9ba9be;
      outline-offset: 6px;
      border-radius: 16px;
    }

    .discord-logo {
      width: 64px;
      height: 64px;
      object-fit: contain;
      opacity: .97;
      transition: transform .22s ease, filter .22s ease, opacity .22s ease;
      filter: drop-shadow(0 8px 14px rgba(15, 23, 42, 0.13));
    }

    .discord-logo-link:hover .discord-logo {
      transform: translateY(-3px) scale(1.07);
      filter: drop-shadow(0 14px 20px rgba(15, 23, 42, 0.18));
      opacity: 1;
    }

    .hidden { display: none !important; }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      background:
        radial-gradient(700px 340px at 8% 8%, rgba(91, 109, 142, 0.22), transparent 68%),
        radial-gradient(860px 340px at 92% 92%, rgba(28, 38, 58, 0.26), transparent 68%),
        rgba(8, 12, 20, 0.42);
      backdrop-filter: blur(9px) saturate(1.08);
      display: grid;
      place-items: center;
      padding: 18px;
      z-index: 50;
      opacity: 0;
      pointer-events: none;
      transition: opacity .2s ease;
    }

    .modal-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }

    .modal {
      width: min(560px, 100%);
      border-radius: 24px;
      border: 1px solid #dde5ef;
      background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
      box-shadow: 0 30px 58px rgba(12, 18, 32, 0.32), inset 0 1px 0 rgba(255,255,255,.9);
      overflow: hidden;
      transform: translateY(8px) scale(.985);
      transition: transform .2s ease;
    }

    .modal-backdrop.open .modal {
      transform: translateY(0) scale(1);
    }

    .modal-head {
      padding: 18px 20px;
      border-bottom: 1px solid #e5ebf3;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .modal-head h3 {
      margin: 0;
      font-size: 1rem;
      letter-spacing: -.015em;
    }

    .close-btn {
      min-height: 38px;
      min-width: 38px;
      border-radius: 10px;
      border: 1px solid #d0d9e6;
      background: #fff;
      cursor: pointer;
      font-size: 1.1rem;
      line-height: 1;
      color: #36465d;
    }

    .modal-body {
      padding: 14px;
      display: grid;
      gap: 12px;
    }

    .animate-in {
      animation: liftIn .44s ease-out;
    }

    @keyframes liftIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 1280px) {
      .page { width: min(1120px, calc(100% - 28px)); }
    }

    @media (max-width: 1024px) {
      .connect-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .hero h2 { max-width: 100%; }
    }

    @media (max-width: 768px) {
      .page {
        width: calc(100% - 18px);
        margin: 10px auto 22px;
      }

      .cards-2,
      .grid-2 {
        grid-template-columns: 1fr;
      }

      .connect-grid { grid-template-columns: 1fr; }

      .hero {
        padding: 22px 18px;
      }

      .content {
        padding: 14px;
      }

      .brand-ribbon img {
        width: 26px;
        height: 26px;
      }
    }

    @media (max-width: 480px) {
      .btn {
        width: 100%;
      }

      .btn-row {
        width: 100%;
      }

      .topbar {
        min-height: 0;
      }

      .brandmark {
        width: 56px;
        height: 56px;
      }

      .discord-logo {
        width: 56px;
        height: 56px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    }
  </style>
  ${extraHead}
</head>
<body>
${body}
</body>
</html>`;
}

function logoStrip() {
  return `
    <div class="brand-ribbon" aria-label="Ondersteunde apps">
      <img src="/assets/brands/shopify.ico" alt="Shopify" />
      <img class="chatgpt-focus" src="/assets/brands/chatgpt.ico" alt="ChatGPT" />
      <img src="/assets/brands/perplexity.ico" alt="Perplexity" />
      <img src="/assets/brands/claude.ico" alt="Claude" />
      <img src="/assets/brands/vscode.ico" alt="Visual Studio Code" />
      <img src="/assets/brands/cursor.ico" alt="Cursor" />
    </div>
  `;
}

function topbar({ actionHtml = "" } = {}) {
  return `
    <header class="topbar animate-in">
      <a class="brandmark-link" href="/onboarding" aria-label="Ga naar onboarding">
        <img class="brandmark" src="/logo.png" alt="Hazify" />
      </a>
      ${actionHtml ? `<div class="topbar-actions">${actionHtml}</div>` : ""}
    </header>
  `;
}

function discordFooter() {
  return `
    <footer class="social-footer">
      <a class="discord-logo-link" href="https://discord.gg/ZuCEvfYC" target="_blank" rel="noopener noreferrer" aria-label="Open Hazify Discord">
        <img class="discord-logo" src="/assets/brands/discord.png" alt="Hazify Discord" />
      </a>
    </footer>
  `;
}

function authForm({ mode, next = "/dashboard" }) {
  const isLogin = mode === "login";
  return `
    <form data-auth-form="${isLogin ? "login" : "signup"}" class="grid-2" style="display:grid;">
      <input type="hidden" name="next" value="${escapeHtml(next)}" />
      ${
        isLogin
          ? ""
          : `<div class="field full"><label for="modalName">Volledige naam</label><input id="modalName" name="name" autocomplete="name" required /></div>`
      }
      <div class="field full">
        <label for="modalEmail${isLogin ? "Login" : "Signup"}">E-mailadres</label>
        <input id="modalEmail${isLogin ? "Login" : "Signup"}" name="email" type="email" autocomplete="email" required />
      </div>
      <div class="field full">
        <label for="modalPassword${isLogin ? "Login" : "Signup"}">Wachtwoord</label>
        <input id="modalPassword${isLogin ? "Login" : "Signup"}" name="password" type="password" autocomplete="${
          isLogin ? "current-password" : "new-password"
        }" ${isLogin ? "" : "minlength=\"10\""} required />
        ${isLogin ? "" : '<p class="helper">Gebruik minimaal 10 tekens.</p>'}
      </div>
      <div class="btn-row">
        <button class="btn primary" type="submit">${isLogin ? "Inloggen" : "Account maken"}</button>
      </div>
    </form>
  `;
}

function authPageShell({ mode, next = "/dashboard", error = "" }) {
  const isLogin = mode === "login";
  return shell({
    title: `${isLogin ? "Inloggen" : "Account maken"} - Hazify`,
    body: `
      <div class="page" style="max-width:760px;">
        ${topbar({})}
        <section class="section animate-in">
          <div class="hero">
            <p class="eyebrow">${isLogin ? "Inloggen" : "Account maken"}</p>
            <h2 style="max-width:13ch;">${isLogin ? "Welkom terug." : "Start je account."}</h2>
            <p class="lead">${isLogin ? "Log in om verder te gaan." : "Maak je account aan en ga door naar je dashboard."}</p>
          </div>
          <div class="content">
            <article class="panel">
              <p id="notice" class="notice ${error ? "err" : "hidden"}">${escapeHtml(error || "")}</p>
              ${authForm({ mode, next })}
              <div class="btn-row">
                <a class="btn soft" href="${isLogin ? `/signup?next=${encodeURIComponent(next)}` : `/login?next=${encodeURIComponent(next)}`}">${isLogin ? "Account maken" : "Inloggen"}</a>
                <a class="btn" href="/onboarding">Terug</a>
              </div>
            </article>
          </div>
        </section>
        ${discordFooter()}
      </div>
      <script>
        const form = document.querySelector('[data-auth-form]');
        const notice = document.getElementById('notice');
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const submit = form.querySelector('button[type="submit"]');
          submit.disabled = true;
          notice.className = 'notice hidden';
          try {
            const data = Object.fromEntries(new FormData(form).entries());
            const next = data.next || '/dashboard';
            delete data.next;
            const endpoint = form.dataset.authForm === 'login' ? '/v1/account/login' : '/v1/account/signup';
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify(data),
            });
            const json = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(json.message || 'Actie mislukt');
            window.location.href = String(next).startsWith('/') ? next : '/dashboard';
          } catch (error) {
            notice.className = 'notice err';
            notice.textContent = error instanceof Error ? error.message : 'Actie mislukt';
          } finally {
            submit.disabled = false;
          }
        });
      </script>
    `,
  });
}

export function renderOnboardingLandingPage() {
  return shell({
    title: "Hazify onboarding",
    body: `
      <div class="page">
        <section class="section animate-in">
          <div class="hero">
            <img class="hero-mark" src="/logo.png" alt="Hazify" />
            <h2>Alles wat je nodig hebt op één plek.</h2>
            <p class="lead">Meld je aan of log in, verbind je winkel en ga direct live in je favoriete apps.</p>
            ${logoStrip()}
          </div>

          <div class="content">
            <div class="cards-2">
              <article class="start-card">
                <h3>Inloggen</h3>
                <p>Gebruik je bestaande account en ga verder waar je bent gebleven.</p>
                <div class="btn-row">
                  <button class="btn primary" type="button" data-open-modal="login">Inloggen</button>
                </div>
              </article>

              <article class="start-card">
                <h3>Account maken</h3>
                <p>Maak binnen een minuut je account aan en start met verbinden.</p>
                <div class="btn-row">
                  <button class="btn primary" type="button" data-open-modal="signup">Account maken</button>
                </div>
              </article>
            </div>
          </div>
        </section>
        ${discordFooter()}
      </div>

      <div class="modal-backdrop" id="modalBackdrop" aria-hidden="true">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="authModalTitle">
          <div class="modal-head">
            <h3 id="authModalTitle">Inloggen</h3>
            <button class="close-btn" type="button" id="closeModal" aria-label="Sluiten">×</button>
          </div>
          <div class="modal-body">
            <p id="modalNotice" class="notice hidden"></p>
            <div id="modalFormHost"></div>
            <div class="btn-row">
              <button class="btn" type="button" id="switchModeBtn">Nog geen account?</button>
            </div>
          </div>
        </div>
      </div>

      <template id="loginFormTemplate">
        ${authForm({ mode: "login" })}
      </template>
      <template id="signupFormTemplate">
        ${authForm({ mode: "signup" })}
      </template>

      <script>
        const backdrop = document.getElementById('modalBackdrop');
        const formHost = document.getElementById('modalFormHost');
        const modalTitle = document.getElementById('authModalTitle');
        const modalNotice = document.getElementById('modalNotice');
        const switchModeBtn = document.getElementById('switchModeBtn');
        const closeModalBtn = document.getElementById('closeModal');
        const loginTemplate = document.getElementById('loginFormTemplate');
        const signupTemplate = document.getElementById('signupFormTemplate');

        let mode = 'login';

        function setMode(nextMode) {
          mode = nextMode === 'signup' ? 'signup' : 'login';
          const template = mode === 'login' ? loginTemplate : signupTemplate;
          modalTitle.textContent = mode === 'login' ? 'Inloggen' : 'Account maken';
          switchModeBtn.textContent = mode === 'login' ? 'Nog geen account?' : 'Ik heb al een account';
          formHost.innerHTML = '';
          formHost.appendChild(template.content.cloneNode(true));
          modalNotice.className = 'notice hidden';
          bindForm();
        }

        function openModal(nextMode) {
          setMode(nextMode);
          backdrop.classList.add('open');
          backdrop.setAttribute('aria-hidden', 'false');
          const firstInput = formHost.querySelector('input[name="email"], input[name="name"]');
          if (firstInput) firstInput.focus();
        }

        function closeModal() {
          backdrop.classList.remove('open');
          backdrop.setAttribute('aria-hidden', 'true');
        }

        function bindForm() {
          const form = formHost.querySelector('[data-auth-form]');
          if (!form) return;
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const submit = form.querySelector('button[type="submit"]');
            submit.disabled = true;
            modalNotice.className = 'notice hidden';
            try {
              const data = Object.fromEntries(new FormData(form).entries());
              const next = data.next || '/dashboard';
              delete data.next;
              const endpoint = form.dataset.authForm === 'login' ? '/v1/account/login' : '/v1/account/signup';
              const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(data),
              });
              const json = await response.json().catch(() => ({}));
              if (!response.ok) throw new Error(json.message || 'Actie mislukt');
              window.location.href = String(next).startsWith('/') ? next : '/dashboard';
            } catch (error) {
              modalNotice.className = 'notice err';
              modalNotice.textContent = error instanceof Error ? error.message : 'Actie mislukt';
            } finally {
              submit.disabled = false;
            }
          });
        }

        document.querySelectorAll('[data-open-modal]').forEach((button) => {
          button.addEventListener('click', () => openModal(button.getAttribute('data-open-modal') || 'login'));
        });

        switchModeBtn.addEventListener('click', () => setMode(mode === 'login' ? 'signup' : 'login'));
        closeModalBtn.addEventListener('click', closeModal);

        backdrop.addEventListener('click', (event) => {
          if (event.target === backdrop) closeModal();
        });

        window.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' && backdrop.classList.contains('open')) {
            closeModal();
          }
        });
      </script>
    `,
  });
}

export function renderLoginPage({ next = "/dashboard", error = "" }) {
  const safeNext = typeof next === "string" && next.startsWith("/") ? next : "/dashboard";
  return authPageShell({ mode: "login", next: safeNext, error });
}

export function renderSignupPage({ next = "/dashboard", error = "" }) {
  const safeNext = typeof next === "string" && next.startsWith("/") ? next : "/dashboard";
  return authPageShell({ mode: "signup", next: safeNext, error });
}

export function renderDashboardPage() {
  return shell({
    title: "Dashboard - Hazify",
    body: `
      <div class="page">
        ${topbar({
          actionHtml: '<button class="btn soft" id="logoutTopBtn" type="button">Afmelden</button>',
        })}

        <section class="section animate-in">
          <div class="hero">
            <h2>Alles wat je nodig hebt op één plek.</h2>
            <p class="lead">Beheer je winkels, verbind je favoriete apps en houd alles overzichtelijk vanuit je account.</p>
            ${logoStrip()}
          </div>

          <div class="content">
            <p id="notice" class="notice warn">We laden je gegevens...</p>

            <div class="grid-2" style="align-items:start;">
              <article class="panel">
                <h3>Jouw account</h3>
                <p>Voeg meerdere winkels toe en kies direct met welke winkel je verder werkt.</p>

                <div class="grid-2">
                  <div class="field full">
                    <label>Naam</label>
                    <input id="accountName" disabled value="-" />
                  </div>
                  <div class="field full">
                    <label>E-mailadres</label>
                    <input id="accountEmail" disabled value="-" />
                  </div>
                  <div class="field full">
                    <label>Actieve winkel</label>
                    <input id="shopDomainValue" disabled value="Nog niet verbonden" />
                  </div>
                </div>

                <form id="connectForm" class="grid-2" style="display:grid; margin-top:6px;">
                  <div class="field full">
                    <label for="shopDomain">Nieuwe winkel koppelen</label>
                    <input id="shopDomain" name="shopDomain" placeholder="jouw-store.myshopify.com" required />
                  </div>

                  <div class="field full">
                    <label for="connectMode">Verbindingsmethode</label>
                    <select id="connectMode" name="connectMode">
                      <option value="client">Via app-sleutels</option>
                      <option value="token">Via admin toegangscode</option>
                    </select>
                  </div>

                  <div class="field" id="clientIdField">
                    <label for="shopClientId">Client ID</label>
                    <input id="shopClientId" name="shopClientId" />
                  </div>
                  <div class="field" id="clientSecretField">
                    <label for="shopClientSecret">Client secret</label>
                    <input id="shopClientSecret" name="shopClientSecret" />
                  </div>

                  <div class="field full hidden" id="accessTokenField">
                    <label for="shopAccessToken">Admin toegangscode</label>
                    <input id="shopAccessToken" name="shopAccessToken" />
                  </div>

                  <div class="btn-row">
                    <button class="btn primary" id="connectBtn" type="submit">Winkel opslaan</button>
                  </div>
                </form>

              </article>

              <article class="panel">
                <h3>Je winkels</h3>
                <p>Wissel snel tussen winkels voordat je verbindt.</p>
                <div class="store-list" id="storeList"></div>

                <div style="height:10px;"></div>
                <h3>Apps verbinden</h3>
                <p>Kies je app en druk op Connect. Als een deeplink niet opent, staat de verbindingscode al op je klembord.</p>

                <div class="connect-grid" id="connectGrid">
                  <article class="connect-card" data-client="chatgpt">
                    <div class="connect-icon-wrap"><img src="/assets/brands/chatgpt.ico" alt="ChatGPT" /></div>
                    <h4>ChatGPT</h4>
                    <button class="btn primary" type="button" data-connect="chatgpt">Connect</button>
                  </article>

                  <article class="connect-card" data-client="codex">
                    <div class="connect-icon-wrap"><img src="/assets/brands/codex.ico" alt="Codex" /></div>
                    <h4>Codex</h4>
                    <button class="btn primary" type="button" data-connect="codex">Connect</button>
                  </article>

                  <article class="connect-card" data-client="perplexity">
                    <div class="connect-icon-wrap"><img src="/assets/brands/perplexity.ico" alt="Perplexity" /></div>
                    <h4>Perplexity</h4>
                    <button class="btn primary" type="button" data-connect="perplexity">Connect</button>
                  </article>

                  <article class="connect-card" data-client="claude">
                    <div class="connect-icon-wrap"><img src="/assets/brands/claude.ico" alt="Claude" /></div>
                    <h4>Claude</h4>
                    <button class="btn primary" type="button" data-connect="claude">Connect</button>
                  </article>

                  <article class="connect-card" data-client="vscode">
                    <div class="connect-icon-wrap"><img src="/assets/brands/vscode.ico" alt="Visual Studio Code" /></div>
                    <h4>Visual Studio Code</h4>
                    <button class="btn primary" type="button" data-connect="vscode">Connect</button>
                  </article>

                  <article class="connect-card" data-client="cursor">
                    <div class="connect-icon-wrap"><img src="/assets/brands/cursor.ico" alt="Cursor" /></div>
                    <h4>Cursor</h4>
                    <button class="btn primary" type="button" data-connect="cursor">Connect</button>
                  </article>
                </div>

                <div style="height:10px;"></div>
                <h3>Actieve koppelingen</h3>
                <p class="mini-note">Zodra een app is verbonden zie je die hier terug.</p>
                <div class="connection-list" id="activeConnections"></div>
              </article>
            </div>
          </div>
        </section>

        ${discordFooter()}
      </div>

      <script>
        const state = {
          selectedClient: 'chatgpt',
          selectedTenantId: '',
          dashboard: null,
          latestToken: '',
        };

        const notice = document.getElementById('notice');
        const accountName = document.getElementById('accountName');
        const accountEmail = document.getElementById('accountEmail');
        const shopDomainValue = document.getElementById('shopDomainValue');
        const storeList = document.getElementById('storeList');
        const activeConnections = document.getElementById('activeConnections');

        const connectForm = document.getElementById('connectForm');
        const connectBtn = document.getElementById('connectBtn');
        const connectMode = document.getElementById('connectMode');
        const clientIdField = document.getElementById('clientIdField');
        const clientSecretField = document.getElementById('clientSecretField');
        const accessTokenField = document.getElementById('accessTokenField');

        const connectGrid = document.getElementById('connectGrid');

        const logoutTopBtn = document.getElementById('logoutTopBtn');

        function setNotice(type, message) {
          notice.className = 'notice ' + type;
          notice.textContent = message;
        }

        function escapeText(value) {
          return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function formatDate(value) {
          if (!value) return '';
          const date = new Date(value);
          if (Number.isNaN(date.getTime())) return '';
          return date.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' });
        }

        async function api(path, options = {}) {
          const response = await fetch(path, {
            credentials: 'include',
            ...options,
          });
          const json = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(json.message || 'Actie mislukt');
          }
          return json;
        }

        function updateMode() {
          const tokenMode = connectMode.value === 'token';
          clientIdField.classList.toggle('hidden', tokenMode);
          clientSecretField.classList.toggle('hidden', tokenMode);
          accessTokenField.classList.toggle('hidden', !tokenMode);
          document.getElementById('shopClientId').required = !tokenMode;
          document.getElementById('shopClientSecret').required = !tokenMode;
          document.getElementById('shopAccessToken').required = tokenMode;
        }

        function markSelectedClient(client) {
          state.selectedClient = client;
          connectGrid.querySelectorAll('.connect-card').forEach((card) => {
            card.classList.toggle('active', card.dataset.client === client);
          });
        }

        function buildSnippet(client, token = '') {
          const endpoint = state.dashboard?.mcp?.url || 'https://hazify-mcp-remote-production.up.railway.app/mcp';
          const accessCode = token || state.latestToken || 'hzmcp_REPLACE_ME';

          if (client === 'vscode') {
            return JSON.stringify({
              servers: {
                hazify: {
                  type: 'http',
                  url: endpoint,
                },
              },
            }, null, 2);
          }

          if (client === 'cursor') {
            return JSON.stringify({
              mcpServers: {
                hazify: {
                  url: endpoint,
                },
              },
            }, null, 2);
          }

          if (client === 'chatgpt' || client === 'codex') {
            return 'Serverlink:\\n' + endpoint + '\\n\\nKies in de app voor verbinden via browser en rond daarna de bevestiging af.';
          }

          return JSON.stringify({
            command: 'npx',
            args: ['-y', 'mcp-remote', endpoint, '--transport', 'http-only', '--header', 'x-api-key: \${HAZIFY_ACCESS_CODE}'],
            env: { HAZIFY_ACCESS_CODE: accessCode },
            useBuiltInNode: true,
          }, null, 2);
        }

        function buildOpenUrl(client) {
          if (client === 'chatgpt') return 'https://chatgpt.com/#settings/connectors';
          if (client === 'codex') return 'https://developers.openai.com';
          if (client === 'perplexity') return 'https://www.perplexity.ai/';
          if (client === 'claude') return 'https://claude.ai/';
          if (client === 'vscode') {
            if (!state.dashboard?.mcp?.url) return '';
            const payload = { name: 'hazify', type: 'http', url: state.dashboard.mcp.url };
            return 'vscode:mcp/install?' + encodeURIComponent(JSON.stringify(payload));
          }
          if (client === 'cursor') {
            if (!state.dashboard?.mcp?.url) return '';
            const payload = JSON.stringify({ url: state.dashboard.mcp.url });
            return 'https://cursor.com/en-US/install-mcp?name=' + encodeURIComponent('hazify') + '&config=' + encodeURIComponent(btoa(payload));
          }
          return '';
        }

        function openLink(url) {
          if (!url) return;
          if (url.startsWith('vscode:')) {
            window.location.href = url;
            return;
          }
          const opened = window.open(url, '_blank', 'noopener,noreferrer');
          if (!opened) {
            window.location.href = url;
          }
        }

        async function ensureAccessCode() {
          if (state.latestToken) return state.latestToken;
          const payload = {
            name: 'dashboard-connect',
            revokeExisting: false,
            expiresInDays: 30,
          };
          if (state.selectedTenantId) {
            payload.tenantId = state.selectedTenantId;
          }
          const result = await api('/v1/dashboard/mcp-token/create', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          state.latestToken = result?.created?.accessToken || '';
          if (result.dashboard) {
            renderDashboard(result.dashboard);
          }
          return state.latestToken;
        }

        function renderStoreList(tenants = [], activeTenantId = '') {
          if (!Array.isArray(tenants) || !tenants.length) {
            storeList.innerHTML = '<p class="mini-note">Nog geen winkel gekoppeld.</p>';
            return;
          }
          storeList.innerHTML = tenants.map((tenant) => {
            const isActive = tenant.tenantId === activeTenantId;
            const label = tenant.label || tenant.shopify?.domain || 'Winkel';
            const domain = tenant.shopify?.domain || 'Onbekend domein';
            const count = Number(tenant.stats?.activeConnectionCount || 0);
            return '<button class="store-item' + (isActive ? ' active' : '') + '" type="button" data-tenant-id=\"' + escapeText(tenant.tenantId) + '\">' +
              '<div><strong>' + escapeText(label) + '</strong><span>' + escapeText(domain) + '</span></div>' +
              '<span class="store-pill">' + count + ' app' + (count === 1 ? '' : 's') + '</span>' +
            '</button>';
          }).join('');
        }

        function renderActiveConnections(rows = []) {
          const normalizedRows = Array.isArray(rows) ? rows : [];
          if (!normalizedRows.length) {
            activeConnections.innerHTML = '<p class="mini-note">Nog geen actieve app-koppelingen.</p>';
            return;
          }
          activeConnections.innerHTML = normalizedRows.map((row) => {
            const label = row.clientName || 'App';
            const updated = formatDate(row.updatedAt || row.createdAt);
            return '<div class="connection-item"><strong>' + escapeText(label) + '</strong><span>' +
              escapeText(updated || 'Zojuist verbonden') + '</span></div>';
          }).join('');
        }

        function updateConnectAvailability() {
          const disabled = !state.selectedTenantId;
          connectGrid.querySelectorAll('button[data-connect]').forEach((button) => {
            button.disabled = disabled;
          });
        }

        async function connectClient(client) {
          markSelectedClient(client);
          if (!state.selectedTenantId) {
            setNotice('warn', 'Koppel eerst een winkel voordat je een app verbindt.');
            return;
          }
          try {
            let token = '';
            if (client === 'claude' || client === 'perplexity') {
              token = await ensureAccessCode();
            }
            const snippet = buildSnippet(client, token);
            await navigator.clipboard.writeText(snippet);
            openLink(buildOpenUrl(client));
            setNotice('ok', 'Connect gestart. De verbindingscode staat op je klembord.');
          } catch (error) {
            setNotice('err', error instanceof Error ? error.message : 'Connect is mislukt.');
          }
        }

        function renderDashboard(data) {
          state.dashboard = data;
          state.selectedTenantId = data.tenant?.tenantId || '';
          accountName.value = data.account?.name || '-';
          accountEmail.value = data.account?.email || '-';
          shopDomainValue.value = data.tenant?.shopify?.domain || 'Nog niet verbonden';
          const shopDomainInput = document.getElementById('shopDomain');
          if (shopDomainInput && data.tenant?.shopify?.domain) {
            shopDomainInput.value = data.tenant.shopify.domain;
          }
          renderStoreList(data.tenants || [], state.selectedTenantId);
          renderActiveConnections(data.connections?.clients || []);
          updateConnectAvailability();
          markSelectedClient(state.selectedClient || 'chatgpt');
        }

        async function loadDashboard(tenantId = '') {
          const query = tenantId ? '?tenantId=' + encodeURIComponent(tenantId) : '';
          const dashboard = await api('/v1/dashboard/state' + query);
          renderDashboard(dashboard);
          return dashboard;
        }

        connectMode.addEventListener('change', updateMode);
        updateMode();

        connectForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          connectBtn.disabled = true;
          try {
            const data = Object.fromEntries(new FormData(connectForm).entries());
            const mode = data.connectMode;
            delete data.connectMode;
            if (mode === 'token') {
              delete data.shopClientId;
              delete data.shopClientSecret;
            } else {
              delete data.shopAccessToken;
            }
            const requestedDomain = String(data.shopDomain || '').trim().toLowerCase();
            const activeDomain = String(state.dashboard?.tenant?.shopify?.domain || '').trim().toLowerCase();
            if (state.selectedTenantId && requestedDomain && requestedDomain === activeDomain) {
              data.tenantId = state.selectedTenantId;
            }

            const result = await api('/v1/onboarding/connect-shopify', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(data),
            });

            state.latestToken = result?.mcp?.bearerToken || state.latestToken;

            if (result.dashboard) {
              renderDashboard(result.dashboard);
            } else {
              await loadDashboard(state.selectedTenantId);
            }
            setNotice('ok', result.createdNewTenant ? 'Nieuwe winkel is toegevoegd.' : 'Winkelgegevens zijn bijgewerkt.');
            connectForm.reset();
            updateMode();
          } catch (error) {
            setNotice('err', error instanceof Error ? error.message : 'Verbinden mislukt');
          } finally {
            connectBtn.disabled = false;
          }
        });

        connectGrid.addEventListener('click', async (event) => {
          const button = event.target.closest('button[data-connect]');
          if (!button) return;
          const client = button.getAttribute('data-connect') || 'chatgpt';
          await connectClient(client);
        });

        storeList.addEventListener('click', async (event) => {
          const button = event.target.closest('button[data-tenant-id]');
          if (!button) return;
          const tenantId = button.getAttribute('data-tenant-id') || '';
          if (!tenantId) return;
          try {
            await loadDashboard(tenantId);
            state.latestToken = '';
            setNotice('ok', 'Actieve winkel is bijgewerkt.');
          } catch (error) {
            setNotice('err', error instanceof Error ? error.message : 'Wisselen van winkel mislukt.');
          }
        });

        async function logout() {
          await api('/v1/account/logout', { method: 'POST' }).catch(() => null);
          window.location.href = '/onboarding';
        }

        logoutTopBtn.addEventListener('click', logout);

        async function bootstrap() {
          const session = await api('/v1/session/bootstrap');
          if (!session.authenticated) {
            window.location.href = '/onboarding';
            return;
          }
          await loadDashboard();
          setNotice('ok', 'Dashboard klaar. Kies een app en druk op Connect.');
        }

        bootstrap().catch((error) => {
          setNotice('err', error instanceof Error ? error.message : 'Dashboard kon niet laden.');
        });
      </script>
    `,
  });
}

export function renderOAuthReconnectPage({
  clientId = "",
  redirectUri = "",
  error = "invalid_client",
  errorCode = "oauth_client_expired",
}) {
  const query = new URLSearchParams({
    reconnect: "1",
    client_id: clientId,
    redirect_uri: redirectUri,
    error,
    error_code: errorCode,
  });

  return shell({
    title: "Koppeling verlopen",
    body: `
      <div class="page" style="max-width:760px;">
        ${topbar({})}
        <section class="section animate-in">
          <div class="hero">
            <p class="eyebrow">Koppeling verlopen</p>
            <h2 style="max-width:14ch;">Deze koppeling is verlopen.</h2>
            <p class="lead">Je gegevens zijn veilig. Verbind de app opnieuw vanuit je dashboard.</p>
          </div>
          <div class="content">
            <article class="panel">
              <p class="notice warn">Deze app gebruikt een verouderde koppeling.</p>
              <div class="btn-row">
                <a class="btn primary" href="/dashboard?${query.toString()}">Opnieuw koppelen</a>
                <a class="btn" href="/dashboard">Terug naar dashboard</a>
              </div>
            </article>
          </div>
        </section>
      </div>
    `,
  });
}

export function renderOAuthAuthorizePage({
  clientName = "",
  clientId = "",
  redirectUri = "",
  state = "",
  responseType = "code",
  codeChallenge = "",
  codeChallengeMethod = "S256",
  scope = "",
  shopDomain = "",
  shopOptions = [],
  error = "",
}) {
  const options = shopOptions
    .map((entry) => `<option value="${escapeHtml(entry)}" ${entry === shopDomain ? "selected" : ""}>${escapeHtml(entry)}</option>`)
    .join("");
  const hasMultipleShops = shopOptions.length > 1;

  return shell({
    title: "Bevestig koppeling",
    body: `
      <div class="page" style="max-width:820px;">
        ${topbar({})}
        <section class="section animate-in">
          <div class="hero">
            <p class="eyebrow">Bevestigen</p>
            <h2 style="max-width:15ch;">${escapeHtml(clientName || "Deze app")} verbinden?</h2>
            <p class="lead">Je kunt dit altijd later aanpassen in je dashboard.</p>
          </div>

          <div class="content">
            ${error ? `<p class="notice err">${escapeHtml(error)}</p>` : ""}
            <article class="panel">
              <form method="POST" action="/oauth/authorize" class="grid-2" style="display:grid;">
                <input type="hidden" name="client_id" value="${escapeHtml(clientId)}" />
                <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
                <input type="hidden" name="state" value="${escapeHtml(state)}" />
                <input type="hidden" name="response_type" value="${escapeHtml(responseType || "code")}" />
                <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}" />
                <input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod || "S256")}" />
                <input type="hidden" name="scope" value="${escapeHtml(scope || "")}" />

                ${
                  hasMultipleShops
                    ? `
                <div class="field full">
                  <label for="shopDomain">Voor welke winkel wil je deze app gebruiken?</label>
                  <select id="shopDomain" name="shopDomain">${options}</select>
                </div>
                `
                    : shopOptions.length === 1
                    ? `<input type="hidden" name="shopDomain" value="${escapeHtml(shopOptions[0])}" />`
                    : ""
                }

                <div class="btn-row">
                  <button class="btn primary" type="submit" name="decision" value="allow">Verbinden</button>
                  <button class="btn" type="submit" name="decision" value="deny">Niet nu</button>
                </div>
              </form>
            </article>
          </div>
        </section>
      </div>
    `,
  });
}
