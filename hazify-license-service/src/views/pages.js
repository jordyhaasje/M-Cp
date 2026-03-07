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
        radial-gradient(980px 400px at 110% -10%, rgba(20, 20, 24, 0.06), transparent 68%),
        radial-gradient(760px 400px at -18% 105%, rgba(56, 58, 64, 0.08), transparent 70%),
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
      gap: 16px;
      align-items: stretch;
    }

    .start-card {
      position: relative;
      overflow: hidden;
      min-height: 198px;
      border-radius: var(--radius-xl);
      border: 0;
      background:
        radial-gradient(220px 130px at 96% 6%, rgba(255,255,255,0.9), transparent 70%),
        linear-gradient(180deg, #f3f6fb 0%, #edf2f9 100%);
      padding: 22px;
      display: grid;
      align-content: start;
      gap: 12px;
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.92),
        0 14px 26px rgba(17, 24, 39, 0.08);
      transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
    }

    .start-card::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      border: 1px solid rgba(184, 198, 218, 0.48);
      pointer-events: none;
    }

    .start-card.login-card {
      background:
        radial-gradient(260px 150px at 92% 8%, rgba(255,255,255,0.95), transparent 72%),
        linear-gradient(180deg, #f1f5fb 0%, #eaf0f8 100%);
    }

    .start-card.signup-card {
      background:
        radial-gradient(260px 150px at 92% 8%, rgba(255,255,255,0.95), transparent 72%),
        linear-gradient(180deg, #f4f7fc 0%, #edf3fb 100%);
    }

    .start-card:hover {
      transform: translateY(-2px);
      filter: saturate(1.03);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.95),
        0 20px 32px rgba(15, 23, 42, 0.12);
    }

    .start-card h3 {
      margin: 0;
      font-size: clamp(1.2rem, 1.56vw, 1.42rem);
      letter-spacing: -.02em;
    }

    .start-card p {
      margin: 0;
      color: var(--muted);
      max-width: 35ch;
      font-size: .98rem;
      line-height: 1.48;
    }

    .start-card .btn-row {
      margin-top: auto;
      padding-top: 6px;
    }

    .start-card .btn.primary {
      min-height: 46px;
      border-radius: 14px;
      padding: 10px 20px;
      font-size: .97rem;
      letter-spacing: -.012em;
      box-shadow: 0 14px 24px rgba(17, 24, 39, 0.18);
      border-color: #090909;
    }

    .start-card .btn.primary:hover {
      transform: translateY(-1px) scale(1.012);
      box-shadow: 0 18px 28px rgba(17, 24, 39, 0.24);
    }

    .onboarding-section .hero {
      padding: clamp(15px, 2.25vw, 21px);
      gap: 8px;
      border-bottom: 1px solid #e7e8eb;
      background:
        radial-gradient(520px 180px at 100% 0%, rgba(24, 24, 28, 0.04), transparent 70%),
        linear-gradient(180deg, #f8f8f9 0%, #f5f6f8 100%);
    }

    .onboarding-section .lead {
      max-width: 58ch;
    }

    .onboarding-section .brand-ribbon {
      margin-top: 2px;
      min-height: 34px;
      gap: 8px;
    }

    .onboarding-content {
      padding: 0;
      gap: 0;
    }

    .onboarding-cards {
      gap: 0;
      border-top: 1px solid #e7e8eb;
      background: linear-gradient(180deg, #f2f3f5 0%, #eeeff2 100%);
    }

    .onboarding-cards .start-card {
      min-height: 192px;
      padding: 22px 24px;
      gap: 10px;
      border-radius: 0;
      box-shadow: none;
      filter: none;
      transform: none;
      transition: background-color .14s ease;
      background: linear-gradient(180deg, #f3f4f6 0%, #eff1f4 100%);
    }

    .onboarding-cards .start-card::after {
      display: none;
    }

    .onboarding-cards .start-card + .start-card {
      border-left: 1px solid #dfe2e8;
    }

    .onboarding-cards .start-card.login-card {
      background: linear-gradient(180deg, #f3f4f6 0%, #eef0f3 100%);
    }

    .onboarding-cards .start-card.signup-card {
      background: linear-gradient(180deg, #f2f3f5 0%, #edeff2 100%);
    }

    .onboarding-cards .start-card:hover {
      transform: none;
      box-shadow: none;
      filter: none;
      background: linear-gradient(180deg, #f5f6f8 0%, #f0f2f5 100%);
    }

    .onboarding-cards .start-card h3 {
      font-size: clamp(1.12rem, 1.24vw, 1.25rem);
    }

    .onboarding-cards .start-card p {
      max-width: 32ch;
      font-size: .94rem;
      line-height: 1.4;
      color: #4d5666;
    }

    .onboarding-cards .start-card .btn-row {
      margin-top: auto;
      padding-top: 4px;
    }

    .onboarding-cards .start-card .btn.primary {
      min-height: 42px;
      border-radius: 10px;
      padding: 8px 18px;
      font-size: .88rem;
      box-shadow: 0 8px 16px rgba(17, 24, 39, 0.16);
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

    .btn.danger {
      background: #fff2f2;
      border-color: #f0c5c1;
      color: #922018;
    }

    .btn.danger:hover {
      border-color: #e8aba6;
      box-shadow: 0 10px 18px rgba(146, 32, 24, 0.12);
    }

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

    select {
      appearance: none;
      -webkit-appearance: none;
      padding-right: 38px;
      background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.25L6 6.25L11 1.25' stroke='%231A273D' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 13px center;
      background-size: 12px 8px;
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

    .connect-tabs {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      border: 1px solid #d7e0ed;
      border-radius: 999px;
      background: #f5f8fc;
    }

    .connect-tab {
      min-height: 34px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: #4f6078;
      font: inherit;
      font-size: .79rem;
      font-weight: 700;
      letter-spacing: -.01em;
      padding: 7px 12px;
      cursor: pointer;
      transition: background-color .14s ease, color .14s ease, box-shadow .14s ease;
    }

    .connect-tab.active {
      background: #fff;
      color: #111a2c;
      box-shadow: 0 8px 16px rgba(15, 23, 42, 0.08);
    }

    .connect-pane {
      margin-top: 10px;
    }

    .connect-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0,1fr));
      gap: 10px;
    }

    .connect-card {
      border: 1px solid #dce4ef;
      border-radius: 16px;
      background: linear-gradient(180deg, #ffffff 0%, #f9fbff 100%);
      min-height: 142px;
      padding: 13px;
      display: grid;
      align-content: space-between;
      justify-items: start;
      gap: 12px;
      transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
    }

    .connect-card:hover {
      transform: translateY(-2px);
      border-color: #c7d1e1;
      box-shadow: 0 14px 24px rgba(15, 23, 42, 0.09);
    }

    .connect-card.active {
      border-color: #0f172a;
      box-shadow: 0 14px 24px rgba(15, 23, 42, 0.14);
    }

    .connect-card-top {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
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
      flex-shrink: 0;
    }

    .connect-icon-wrap img {
      width: 22px;
      height: 22px;
      object-fit: contain;
    }

    .connect-card h4 {
      margin: 0;
      font-size: .88rem;
      line-height: 1.2;
      letter-spacing: -.01em;
    }

    .connect-card p {
      margin: 0;
      font-size: .76rem;
      color: #637690;
      line-height: 1.45;
    }

    .connect-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      flex-wrap: wrap;
    }

    .connect-actions .btn {
      min-height: 34px;
      font-size: .76rem;
      padding: 7px 10px;
    }

    .setup-list {
      display: grid;
      gap: 8px;
    }

    .setup-item {
      border: 1px solid #dce4ef;
      border-radius: 14px;
      background: linear-gradient(180deg, #ffffff 0%, #fafcff 100%);
      padding: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      transition: border-color .14s ease, box-shadow .14s ease, background-color .14s ease;
    }

    .setup-item:hover {
      border-color: #c7d2e2;
      box-shadow: 0 10px 18px rgba(15, 23, 42, 0.08);
    }

    .setup-item-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .setup-item h4 {
      margin: 0;
      font-size: .86rem;
      line-height: 1.2;
    }

    .setup-item p {
      margin: 2px 0 0;
      font-size: .74rem;
      color: #66788f;
      line-height: 1.4;
    }

    .setup-btn {
      min-height: 34px;
      padding: 7px 10px;
      font-size: .74rem;
      white-space: nowrap;
    }

    .quick-connect-item.active {
      border-color: #c7d2e2;
      background: linear-gradient(180deg, #ffffff 0%, #fafcff 100%);
      box-shadow: 0 10px 18px rgba(15, 23, 42, 0.08);
    }

    .setup-modal {
      width: min(760px, 100%);
    }

    .setup-modal-body {
      padding: 16px;
      display: grid;
      gap: 12px;
    }

    .setup-intro {
      margin: 0;
      font-size: .8rem;
      color: #536780;
      line-height: 1.45;
    }

    .setup-guide-grid {
      display: grid;
      gap: 10px;
    }

    .setup-guide-panel {
      border: 1px solid #dbe4ef;
      border-radius: 14px;
      background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
      padding: 12px;
      display: grid;
      gap: 10px;
    }

    .setup-guide-panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .setup-guide-panel-head h4 {
      margin: 0;
      font-size: .84rem;
      color: #1f3048;
      letter-spacing: -.01em;
    }

    .setup-guide-count {
      border: 1px solid #d7e0ed;
      border-radius: 999px;
      background: #f2f6fc;
      color: #4c607a;
      font-size: .69rem;
      font-weight: 700;
      padding: 4px 9px;
      white-space: nowrap;
    }

    .setup-steps {
      margin: 0;
      padding: 0;
      list-style: none;
      counter-reset: setup-step;
      display: grid;
      gap: 8px;
    }

    .setup-steps li {
      counter-increment: setup-step;
      border: 1px solid #d9e2ee;
      border-radius: 12px;
      background: #fff;
      padding: 9px 10px;
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      gap: 9px;
      font-size: .77rem;
      line-height: 1.45;
      color: #2f425b;
      letter-spacing: -.003em;
    }

    .setup-steps li::before {
      content: counter(setup-step);
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 1px solid #c6d3e5;
      background: #edf4fd;
      color: #1f3553;
      font-size: .72rem;
      font-weight: 800;
      display: inline-grid;
      place-items: center;
      line-height: 1;
    }

    .setup-format {
      display: grid;
      gap: 8px;
    }

    .setup-snippet-tabs {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 4px;
      border-radius: 999px;
      border: 1px solid #d7e0ec;
      background: #f5f8fc;
      width: fit-content;
      max-width: 100%;
    }

    .setup-snippet-tab {
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: #4a5e77;
      font-size: .72rem;
      font-weight: 700;
      letter-spacing: -.01em;
      min-height: 30px;
      padding: 4px 10px;
      cursor: pointer;
      transition: background .14s ease, color .14s ease, box-shadow .14s ease;
    }

    .setup-snippet-tab:hover {
      color: #1d2f48;
      background: #eef4fb;
    }

    .setup-snippet-tab.active {
      color: #111f34;
      background: #fff;
      box-shadow: 0 8px 14px rgba(15, 23, 42, 0.08);
    }

    .setup-format-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .setup-format-head strong {
      font-size: .82rem;
      color: #233248;
      letter-spacing: -.01em;
    }

    .setup-format-caption {
      margin: 0;
      color: #5a6d86;
      font-size: .74rem;
      line-height: 1.35;
    }

    .setup-snippet {
      margin: 0;
      min-height: 132px;
      max-height: 250px;
      overflow: auto;
      border-radius: 12px;
      border: 1px solid #d6e0ee;
      background: #f4f8fd;
      padding: 10px 11px;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--font-mono);
      font-size: .74rem;
      color: #203047;
      line-height: 1.52;
    }

    .help-pane {
      display: grid;
      gap: 12px;
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

    .store-details-modal {
      width: min(640px, 100%);
    }

    .store-details-body {
      display: grid;
      gap: 10px;
    }

    .store-credentials-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .store-credentials-grid .field {
      margin: 0;
    }

    .store-credentials-grid input {
      min-height: 40px;
      font-size: .76rem;
      color: #2a3b53;
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

    .connection-meta {
      display: grid;
      gap: 1px;
      min-width: 0;
    }

    .connection-item strong {
      font-size: .8rem;
      color: #1c2b41;
    }

    .connection-item span {
      font-size: .72rem;
      color: #64748c;
    }

    .connection-revoke-x {
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: #8d2634;
      font-size: 1rem;
      line-height: 1;
      padding: 0;
      cursor: pointer;
      display: inline-grid;
      place-items: center;
      flex-shrink: 0;
      transition: background-color .14s ease, color .14s ease;
    }

    .connection-revoke-x:hover {
      background: #fff0f1;
      color: #6f1a25;
    }

    .connection-revoke-x:disabled {
      opacity: .45;
      cursor: not-allowed;
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

      .setup-item {
        padding: 10px;
      }

      .setup-item-left {
        gap: 8px;
      }

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

      .start-card {
        min-height: 184px;
        padding: 18px;
      }

      .start-card p {
        font-size: .93rem;
      }

      .onboarding-section .hero {
        padding: 14px 13px;
        gap: 7px;
      }

      .onboarding-content {
        padding: 0;
      }

      .onboarding-cards {
        gap: 0;
      }

      .onboarding-cards .start-card {
        min-height: 0;
        padding: 16px;
      }

      .onboarding-cards .start-card p {
        font-size: .9rem;
      }

      .onboarding-cards .start-card + .start-card {
        border-left: 0;
        border-top: 1px solid #dfe2e8;
      }
    }

    @media (max-width: 480px) {
      .btn {
        width: 100%;
      }

      .setup-item .setup-btn {
        width: auto;
        min-width: 110px;
      }

      .store-credentials-grid {
        grid-template-columns: 1fr;
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
        <section class="section animate-in onboarding-section">
          <div class="hero onboarding-hero">
            <img class="hero-mark" src="/logo.png" alt="Hazify" />
            <h2>Alles wat je nodig hebt op één plek.</h2>
            <p class="lead">Meld je aan of log in, verbind je winkel en ga direct live in je favoriete apps.</p>
            ${logoStrip()}
          </div>

          <div class="content onboarding-content">
            <div class="cards-2 onboarding-cards">
              <article class="start-card login-card">
                <h3>Inloggen</h3>
                <p>Gebruik je bestaande account en ga verder waar je bent gebleven.</p>
                <div class="btn-row">
                  <button class="btn primary" type="button" data-open-modal="login">Inloggen</button>
                </div>
              </article>

              <article class="start-card signup-card">
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
                <p>Gebruik snelle setup voor one-click apps. Voor andere apps open je een heldere setupgids met het juiste formaat.</p>

                <div class="connect-tabs" id="connectTabs" role="tablist" aria-label="App setup type">
                  <button class="connect-tab active" type="button" role="tab" data-connect-tab="quick" aria-selected="true">Snelle setup</button>
                  <button class="connect-tab" type="button" role="tab" data-connect-tab="other" aria-selected="false">Andere apps</button>
                  <button class="connect-tab" type="button" role="tab" data-connect-tab="help" aria-selected="false">Help</button>
                </div>

                <div class="connect-pane" data-connect-pane="quick">
                  <div class="setup-list quick-setup-list" id="connectGrid">
                    <article class="setup-item quick-connect-item" data-quick-client="vscode">
                      <div class="setup-item-left">
                        <div class="connect-icon-wrap"><img src="/assets/brands/vscode.ico" alt="Visual Studio Code" /></div>
                        <div>
                          <h4>Visual Studio Code</h4>
                          <p>One-click installatie via deeplink.</p>
                        </div>
                      </div>
                      <button class="btn setup-btn" type="button" data-connect="vscode">Connect</button>
                    </article>

                    <article class="setup-item quick-connect-item" data-quick-client="cursor">
                      <div class="setup-item-left">
                        <div class="connect-icon-wrap"><img src="/assets/brands/cursor.ico" alt="Cursor" /></div>
                        <div>
                          <h4>Cursor</h4>
                          <p>One-click installatie via deeplink.</p>
                        </div>
                      </div>
                      <button class="btn setup-btn" type="button" data-connect="cursor">Connect</button>
                    </article>

                    <article class="setup-item quick-connect-item" data-quick-client="codex">
                      <div class="setup-item-left">
                        <div class="connect-icon-wrap"><img src="/assets/brands/codex.ico" alt="Codex" /></div>
                        <div>
                          <h4>Codex</h4>
                          <p>Open setup en kopieer direct je serverlink.</p>
                        </div>
                      </div>
                      <button class="btn setup-btn" type="button" data-connect="codex">Connect</button>
                    </article>
                  </div>
                </div>

                <div class="connect-pane hidden" data-connect-pane="other">
                  <div class="setup-list">
                    <article class="setup-item">
                      <div class="setup-item-left">
                        <div class="connect-icon-wrap"><img src="/assets/brands/chatgpt.ico" alt="ChatGPT" /></div>
                        <div>
                          <h4>ChatGPT</h4>
                          <p>Verbind via browserbevestiging (URL-formaat).</p>
                        </div>
                      </div>
                      <button class="btn setup-btn" type="button" data-open-setup="chatgpt">Bekijk setup</button>
                    </article>

                    <article class="setup-item">
                      <div class="setup-item-left">
                        <div class="connect-icon-wrap"><img src="/assets/brands/perplexity.ico" alt="Perplexity" /></div>
                        <div>
                          <h4>Perplexity</h4>
                          <p>Gebruik de remote connectorflow met OAuth en kies Streamable HTTP.</p>
                        </div>
                      </div>
                      <button class="btn setup-btn" type="button" data-open-setup="perplexity">Connect</button>
                    </article>

                    <article class="setup-item">
                      <div class="setup-item-left">
                        <div class="connect-icon-wrap"><img src="/assets/brands/claude.ico" alt="Claude" /></div>
                        <div>
                          <h4>Claude</h4>
                          <p>Open de officiële connectorpagina en rond browserautorisatie af.</p>
                        </div>
                      </div>
                      <button class="btn setup-btn" type="button" data-open-setup="claude">Connect</button>
                    </article>
                  </div>
                </div>

                <div class="connect-pane hidden help-pane" data-connect-pane="help">
                  <div class="setup-list">
                    <article class="setup-item">
                      <div class="setup-item-left">
                        <div class="connect-icon-wrap"><img src="/assets/brands/shopify.ico" alt="Shopify" /></div>
                        <div>
                          <h4>Shopify Custom App</h4>
                          <p>Één complete setupgids met scopes en redirect URL's.</p>
                        </div>
                      </div>
                      <button class="btn setup-btn" type="button" data-open-setup="custom-app">Open setup</button>
                    </article>
                  </div>
                </div>

                <div style="height:10px;"></div>
                <h3>Actieve koppelingen</h3>
                <p class="mini-note">Zodra een app is verbonden zie je die hier terug.</p>
                <div class="connection-list" id="activeConnections"></div>
              </article>
            </div>
          </div>
        </section>

        <div class="modal-backdrop" id="setupModalBackdrop" aria-hidden="true">
          <div class="modal setup-modal" role="dialog" aria-modal="true" aria-labelledby="setupModalTitle">
            <div class="modal-head">
              <h3 id="setupModalTitle">App setup</h3>
              <button class="close-btn" type="button" id="setupCloseBtn" aria-label="Sluiten">×</button>
            </div>
            <div class="setup-modal-body">
              <p class="setup-intro" id="setupModalIntro"></p>
              <div class="setup-guide-grid">
                <section class="setup-guide-panel" id="setupStepsPanel">
                  <div class="setup-guide-panel-head">
                    <h4>Stap-voor-stap</h4>
                    <span class="setup-guide-count" id="setupStepCount">0 stappen</span>
                  </div>
                  <ol class="setup-steps" id="setupSteps"></ol>
                </section>
                <section class="setup-guide-panel">
                  <div class="setup-format">
                    <div class="setup-format-head">
                      <strong>Copy-paste</strong>
                      <button class="btn" type="button" id="setupCopyBtn">Kopieer</button>
                    </div>
                    <p class="setup-format-caption" id="setupFormatLabel">Setup formaat</p>
                    <div class="setup-snippet-tabs hidden" id="setupSnippetTabs" role="tablist" aria-label="Setup formaten"></div>
                    <pre class="setup-snippet" id="setupSnippet"></pre>
                  </div>
                </section>
              </div>
              <div class="btn-row">
                <a class="btn soft hidden" id="setupOpenBtn" href="#" target="_blank" rel="noopener noreferrer">Open app</a>
                <button class="btn primary" type="button" id="setupDoneBtn">Klaar</button>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-backdrop" id="storeModalBackdrop" aria-hidden="true">
          <div class="modal store-details-modal" role="dialog" aria-modal="true" aria-labelledby="storeModalTitle">
            <div class="modal-head">
              <h3 id="storeModalTitle">Winkel details</h3>
              <button class="close-btn" type="button" id="storeModalCloseBtn" aria-label="Sluiten">×</button>
            </div>
            <div class="modal-body store-details-body">
              <p class="setup-intro" id="storeModalIntro">Hier zie je de gekoppelde credentials van deze winkel (gemaskeerd).</p>
              <div class="store-credentials-grid">
                <div class="field">
                  <label>Shop domain</label>
                  <input id="storeCredentialDomain" disabled value="-" />
                </div>
                <div class="field">
                  <label>Auth modus</label>
                  <input id="storeCredentialAuthMode" disabled value="-" />
                </div>
                <div class="field">
                  <label>Client ID (masked)</label>
                  <input id="storeCredentialClientId" disabled value="-" />
                </div>
                <div class="field">
                  <label>Client secret (masked)</label>
                  <input id="storeCredentialClientSecret" disabled value="-" />
                </div>
                <div class="field">
                  <label>Access token (masked)</label>
                  <input id="storeCredentialAccessToken" disabled value="-" />
                </div>
                <div class="field">
                  <label>Laatst gevalideerd</label>
                  <input id="storeCredentialLastValidatedAt" disabled value="-" />
                </div>
              </div>
              <div class="btn-row">
                <button class="btn danger" id="storeDeleteBtn" type="button" disabled>Winkel verwijderen</button>
                <button class="btn primary" id="storeModalDoneBtn" type="button">Sluiten</button>
              </div>
            </div>
          </div>
        </div>

        ${discordFooter()}
      </div>

      <script>
        const state = {
          selectedClient: 'vscode',
          selectedTenantId: '',
          dashboard: null,
          latestToken: '',
          activeSetupClient: '',
          activeSetupFormats: [],
          activeSetupFormatIndex: 0,
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
        const connectTabs = document.getElementById('connectTabs');
        const connectPanes = Array.from(document.querySelectorAll('[data-connect-pane]'));

        const setupModalBackdrop = document.getElementById('setupModalBackdrop');
        const setupModalTitle = document.getElementById('setupModalTitle');
        const setupModalIntro = document.getElementById('setupModalIntro');
        const setupStepsPanel = document.getElementById('setupStepsPanel');
        const setupSteps = document.getElementById('setupSteps');
        const setupStepCount = document.getElementById('setupStepCount');
        const setupFormatLabel = document.getElementById('setupFormatLabel');
        const setupSnippetTabs = document.getElementById('setupSnippetTabs');
        const setupSnippet = document.getElementById('setupSnippet');
        const setupCopyBtn = document.getElementById('setupCopyBtn');
        const setupOpenBtn = document.getElementById('setupOpenBtn');
        const setupCloseBtn = document.getElementById('setupCloseBtn');
        const setupDoneBtn = document.getElementById('setupDoneBtn');

        const storeModalBackdrop = document.getElementById('storeModalBackdrop');
        const storeModalTitle = document.getElementById('storeModalTitle');
        const storeModalCloseBtn = document.getElementById('storeModalCloseBtn');
        const storeModalDoneBtn = document.getElementById('storeModalDoneBtn');
        const storeDeleteBtn = document.getElementById('storeDeleteBtn');
        const storeCredentialDomain = document.getElementById('storeCredentialDomain');
        const storeCredentialAuthMode = document.getElementById('storeCredentialAuthMode');
        const storeCredentialClientId = document.getElementById('storeCredentialClientId');
        const storeCredentialClientSecret = document.getElementById('storeCredentialClientSecret');
        const storeCredentialAccessToken = document.getElementById('storeCredentialAccessToken');
        const storeCredentialLastValidatedAt = document.getElementById('storeCredentialLastValidatedAt');

        const logoutTopBtn = document.getElementById('logoutTopBtn');
        const CUSTOM_APP_SCOPES = 'read_products,write_products,read_customers,write_customers,read_orders,write_orders,read_fulfillments,read_inventory,write_merchant_managed_fulfillment_orders';
        const CUSTOM_APP_REDIRECTS = 'http://127.0.0.1:8787/oauth/shopify/callback\\nhttp://localhost:8787/oauth/shopify/callback';

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

        function formatDateTime(value) {
          if (!value) return '';
          const date = new Date(value);
          if (Number.isNaN(date.getTime())) return '';
          return date.toLocaleString('nl-NL', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
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
          connectGrid.querySelectorAll('.quick-connect-item').forEach((row) => {
            row.classList.toggle('active', row.dataset.quickClient === client);
          });
        }

        function getMcpEndpoint() {
          return state.dashboard?.mcp?.url || 'https://hazify-mcp-remote-production.up.railway.app/mcp';
        }

        async function ensureAccessCode(label) {
          if (state.latestToken) {
            return state.latestToken;
          }
          if (!state.selectedTenantId) {
            throw new Error('Koppel eerst een winkel voordat je een verbindingscode maakt.');
          }
          const created = await api('/v1/dashboard/mcp-token/create', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              tenantId: state.selectedTenantId,
              name: label || 'Dashboard Connector',
              expiresInDays: 30,
            }),
          });
          const token = created?.created?.accessToken || '';
          if (!token) {
            throw new Error('Kon geen verbindingscode maken.');
          }
          state.latestToken = token;
          return token;
        }

        function buildSnippet(client, token = '') {
          const endpoint = getMcpEndpoint();
          const accessCode = token || state.latestToken || 'hzmcp_REPLACE_ME';

          if (client === 'vscode') {
            return JSON.stringify({
              servers: {
                'Hazify MCP': {
                  type: 'http',
                  url: endpoint,
                },
              },
            }, null, 2);
          }

          if (client === 'cursor') {
            return JSON.stringify({
              mcpServers: {
                'Hazify MCP': {
                  url: endpoint,
                },
              },
            }, null, 2);
          }

          if (client === 'chatgpt') {
            return endpoint;
          }

          if (client === 'codex') {
            return 'MCP server URL\\n' + endpoint + '\\n\\nKies in Codex voor verbinden via browser.';
          }

          if (client === 'claude') {
            return 'Connector URL\\n' + endpoint + '\\n\\nClaude Code CLI\\nclaude mcp add --transport http \"Hazify MCP\" \"' + endpoint + '\"';
          }

          if (client === 'perplexity') {
            return JSON.stringify({
              mcpServers: {
                'Hazify MCP': {
                  url: endpoint,
                  headers: {
                    'x-api-key': accessCode,
                  },
                },
              },
            }, null, 2);
          }

          return JSON.stringify({
            command: 'npx',
            args: ['-y', 'mcp-remote', endpoint, '--transport', 'http-only', '--header', 'x-api-key: \${HAZIFY_ACCESS_CODE}'],
            env: { HAZIFY_ACCESS_CODE: accessCode },
            useBuiltInNode: true,
          }, null, 2);
        }

        function buildOpenUrl(client) {
          if (client === 'chatgpt') return 'https://chatgpt.com/settings/connectors';
          if (client === 'codex') return 'https://developers.openai.com';
          if (client === 'perplexity') return 'https://www.perplexity.ai/settings/connectors';
          if (client === 'claude') return 'https://claude.ai/settings/connectors';
          if (client === 'vscode') {
            if (!state.dashboard?.mcp?.url) return '';
            const payload = JSON.stringify({
              type: 'http',
              url: state.dashboard.mcp.url,
            });
            return 'https://vscode.dev/redirect/mcp/install?name=' + encodeURIComponent('Hazify MCP') + '&config=' + encodeURIComponent(payload);
          }
          if (client === 'cursor') {
            if (!state.dashboard?.mcp?.url) return '';
            const payload = btoa(JSON.stringify({ url: state.dashboard.mcp.url }));
            return 'cursor://anysphere.cursor-deeplink/mcp/install?name=' + encodeURIComponent('Hazify MCP') + '&config=' + encodeURIComponent(payload);
          }
          return '';
        }

        function setConnectTab(nextTab) {
          const safeTab = nextTab === 'other' || nextTab === 'help' ? nextTab : 'quick';
          connectTabs.querySelectorAll('[data-connect-tab]').forEach((button) => {
            const active = button.getAttribute('data-connect-tab') === safeTab;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
          });
          connectPanes.forEach((pane) => {
            pane.classList.toggle('hidden', pane.getAttribute('data-connect-pane') !== safeTab);
          });
        }

        function openLink(url) {
          if (!url) return;
          const isCustomScheme = /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:/i.test(url);
          if (isCustomScheme) {
            window.location.href = url;
            return;
          }
          const opened = window.open(url, '_blank', 'noopener,noreferrer');
          if (!opened) {
            window.location.href = url;
          }
        }

        function closeSetupModal() {
          setupModalBackdrop.classList.remove('open');
          setupModalBackdrop.setAttribute('aria-hidden', 'true');
        }

        function normalizeSetupFormats(guide) {
          if (Array.isArray(guide.formats) && guide.formats.length) {
            const normalized = guide.formats
              .map((entry, index) => ({
                key: String(entry?.key || 'format-' + index),
                label: String(entry?.label || 'Formaat ' + (index + 1)),
                snippet: String(entry?.snippet || ''),
              }))
              .filter((entry) => entry.snippet.trim().length > 0);
            if (normalized.length) {
              return normalized;
            }
          }
          return [
            {
              key: 'default',
              label: String(guide.formatLabel || 'Setup formaat'),
              snippet: String(guide.snippet || ''),
            },
          ];
        }

        function selectSetupFormat(index) {
          const formats = Array.isArray(state.activeSetupFormats) ? state.activeSetupFormats : [];
          if (!formats.length) {
            setupFormatLabel.textContent = 'Setup formaat';
            setupSnippet.textContent = '';
            setupCopyBtn.dataset.payload = '';
            return;
          }
          const safeIndex = Math.max(0, Math.min(Number(index) || 0, formats.length - 1));
          state.activeSetupFormatIndex = safeIndex;
          const active = formats[safeIndex];
          setupFormatLabel.textContent = active.label;
          setupSnippet.textContent = active.snippet;
          setupCopyBtn.dataset.payload = active.snippet;
          setupSnippetTabs.querySelectorAll('[data-setup-format]').forEach((button) => {
            const buttonIndex = Number(button.getAttribute('data-setup-format'));
            const isActive = buttonIndex === safeIndex;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
          });
        }

        function renderSetupModal(guide) {
          state.activeSetupClient = guide.client;
          setupModalTitle.textContent = guide.title;
          setupModalIntro.textContent = guide.intro;
          const safeSteps = Array.isArray(guide.steps) ? guide.steps.filter((step) => String(step || '').trim()) : [];
          if (safeSteps.length > 0) {
            setupStepsPanel.classList.remove('hidden');
            setupSteps.innerHTML = safeSteps.map((step) => '<li>' + escapeText(step) + '</li>').join('');
            setupStepCount.textContent = safeSteps.length === 1 ? '1 stap' : safeSteps.length + ' stappen';
          } else {
            setupStepsPanel.classList.add('hidden');
            setupSteps.innerHTML = '';
            setupStepCount.textContent = '0 stappen';
          }
          const formats = normalizeSetupFormats(guide);
          state.activeSetupFormats = formats;
          if (formats.length > 1) {
            setupSnippetTabs.innerHTML = formats
              .map((entry, index) => '<button class="setup-snippet-tab' + (index === 0 ? ' active' : '') + '" type="button" role="tab" aria-selected="' + (index === 0 ? 'true' : 'false') + '" data-setup-format="' + index + '">' + escapeText(entry.label) + '</button>')
              .join('');
            setupSnippetTabs.classList.remove('hidden');
          } else {
            setupSnippetTabs.innerHTML = '';
            setupSnippetTabs.classList.add('hidden');
          }
          selectSetupFormat(0);
          if (guide.openUrl) {
            setupOpenBtn.href = guide.openUrl;
            setupOpenBtn.classList.remove('hidden');
          } else {
            setupOpenBtn.href = '#';
            setupOpenBtn.classList.add('hidden');
          }
          setupModalBackdrop.classList.add('open');
          setupModalBackdrop.setAttribute('aria-hidden', 'false');
        }

        async function buildSetupGuide(client) {
          if (client === 'custom-app') {
            return {
              client,
              title: 'Shopify Custom App setup',
              intro: 'Gebruik deze copy-paste waarden in Shopify en sla daarna je winkel op via "Via app-sleutels".',
              steps: [],
              formats: [
                { key: 'scopes', label: 'Scopes (comma separated)', snippet: CUSTOM_APP_SCOPES },
                { key: 'redirects', label: "Redirect URL's", snippet: CUSTOM_APP_REDIRECTS },
              ],
              openUrl: '',
            };
          }

          if (client === 'chatgpt') {
            return {
              client,
              title: 'ChatGPT setup',
              intro: 'Plak de URL en rond de browserbevestiging af.',
              steps: [
                'Open Connectors in ChatGPT.',
                'Voeg een nieuwe connector toe met de URL hieronder.',
                'Bevestig in je browser.',
              ],
              formatLabel: 'URL formaat',
              snippet: buildSnippet('chatgpt'),
              openUrl: buildOpenUrl('chatgpt'),
            };
          }

          if (client === 'perplexity') {
            const token = await ensureAccessCode('Perplexity Connector');
            const endpoint = getMcpEndpoint();
            const commandFallback = 'npx -y mcp-remote "' + endpoint + '" --transport http-only --header "x-api-key: ' + token + '"';
            return {
              client,
              title: 'Perplexity setup',
              intro: 'Kies bij voorkeur OAuth. Gebruik JSON of command als fallback.',
              steps: [
                'Open Connectors in Perplexity en voeg Custom Remote Connector toe.',
                'Gebruik de URL hieronder en zet transport op Streamable HTTP.',
                'Rond OAuth af, of gebruik JSON/Command fallback.',
              ],
              formats: [
                { key: 'streamable', label: 'Streamable URL', snippet: endpoint },
                { key: 'json', label: 'JSON config', snippet: buildSnippet('perplexity', token) },
                { key: 'command', label: 'Command', snippet: commandFallback },
              ],
              openUrl: buildOpenUrl('perplexity'),
            };
          }

          if (client === 'claude') {
            const endpoint = getMcpEndpoint();
            const claudeCommand = 'claude mcp add --transport http "Hazify MCP" "' + endpoint + '"';
            return {
              client,
              title: 'Claude setup',
              intro: 'Koppel snel via Connectors of gebruik Claude Code command.',
              steps: [
                'Open Connectors in Claude.',
                'Voeg de URL hieronder toe als nieuwe connector.',
                'Bevestig in je browser, of gebruik de command-tab.',
              ],
              formats: [
                { key: 'streamable', label: 'Streamable URL', snippet: endpoint },
                { key: 'command', label: 'Claude Code command', snippet: claudeCommand },
              ],
              openUrl: buildOpenUrl('claude'),
            };
          }

          return {
            client: 'codex',
            title: 'Codex setup',
            intro: 'Plak de URL en bevestig in je browser.',
            steps: [
              'Open MCP instellingen in Codex.',
              'Voeg de URL hieronder toe.',
              'Bevestig in je browser.',
            ],
            formatLabel: 'URL formaat',
            snippet: buildSnippet('codex'),
            openUrl: buildOpenUrl('codex'),
          };
        }

        async function openSetupGuide(client) {
          if (client !== 'custom-app' && !state.selectedTenantId) {
            setNotice('warn', 'Koppel eerst een winkel voordat je een app verbindt.');
            return;
          }
          try {
            const guide = await buildSetupGuide(client);
            renderSetupModal(guide);
          } catch (error) {
            setNotice('err', error instanceof Error ? error.message : 'Setup laden is mislukt.');
          }
        }

        function fillStoreDetailsModal(tenantData = null) {
          const shopify = tenantData?.shopify || {};
          const credentials = shopify.credentials || {};
          const authMode =
            shopify.authMode === 'access_token'
              ? 'Access token'
              : shopify.authMode === 'client_credentials'
              ? 'Client credentials'
              : '-';
          const domain = credentials.domain || shopify.domain || '-';
          storeModalTitle.textContent = domain && domain !== '-' ? 'Winkel details · ' + domain : 'Winkel details';
          storeCredentialDomain.value = domain;
          storeCredentialAuthMode.value = authMode;
          storeCredentialClientId.value = credentials.clientIdMasked || '-';
          storeCredentialClientSecret.value = credentials.clientSecretMasked || '-';
          storeCredentialAccessToken.value = credentials.accessTokenMasked || '-';
          storeCredentialLastValidatedAt.value =
            formatDateTime(credentials.lastValidationAt || credentials.validatedAt) || '-';
          storeDeleteBtn.disabled = !tenantData?.tenantId;
        }

        function closeStoreDetailsModal() {
          storeModalBackdrop.classList.remove('open');
          storeModalBackdrop.setAttribute('aria-hidden', 'true');
        }

        function openStoreDetailsModal(tenantData = null) {
          fillStoreDetailsModal(tenantData);
          storeModalBackdrop.classList.add('open');
          storeModalBackdrop.setAttribute('aria-hidden', 'false');
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
            const subtitle = updated ? ('Laatst actief: ' + updated) : 'Actief';
            const connectionKey = row.connectionKey ? String(row.connectionKey) : '';
            const revokeButton = row.revocable && connectionKey
              ? '<button class="connection-revoke-x" type="button" data-revoke-connection="' +
                escapeText(connectionKey) + '" aria-label="Koppeling intrekken" title="Intrekken">×</button>'
              : '';
            return '<div class="connection-item">' +
              '<div class="connection-meta"><strong>' + escapeText(label) + '</strong><span>' +
              escapeText(subtitle) + '</span></div>' +
              revokeButton +
              '</div>';
          }).join('');
        }

        function updateConnectAvailability() {
          const disabled = !state.selectedTenantId;
          document.querySelectorAll('button[data-connect], button[data-open-setup]').forEach((button) => {
            const setupClient = button.getAttribute('data-open-setup') || '';
            button.disabled = setupClient === 'custom-app' ? false : disabled;
          });
        }

        async function connectClient(client) {
          markSelectedClient(client);
          if (!state.selectedTenantId) {
            setNotice('warn', 'Koppel eerst een winkel voordat je een app verbindt.');
            return;
          }
          try {
            const snippet = buildSnippet(client);
            await navigator.clipboard.writeText(snippet);
            const openUrl = buildOpenUrl(client);
            if (openUrl) {
              openLink(openUrl);
            }
            if (client === 'vscode') {
              setNotice('ok', 'VS Code setup gestart. Je rondt de beveiligde browserautorisatie af in de volgende stap.');
            } else if (client === 'cursor') {
              setNotice('ok', 'Cursor setup gestart. Je rondt de beveiligde browserautorisatie af in de volgende stap.');
            } else {
              setNotice('ok', 'Setup gestart. De serverlink staat op je klembord.');
            }
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
          markSelectedClient(state.selectedClient || 'vscode');
        }

        async function loadDashboard(tenantId = '') {
          const query = tenantId ? '?tenantId=' + encodeURIComponent(tenantId) : '';
          const dashboard = await api('/v1/dashboard/state' + query);
          renderDashboard(dashboard);
          return dashboard;
        }

        connectMode.addEventListener('change', updateMode);
        updateMode();
        setConnectTab('quick');

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
          const client = button.getAttribute('data-connect') || 'vscode';
          if (client === 'codex') {
            await openSetupGuide('codex');
            return;
          }
          await connectClient(client);
        });

        document.querySelectorAll('button[data-open-setup]').forEach((button) => {
          button.addEventListener('click', async () => {
            const client = button.getAttribute('data-open-setup') || '';
            if (!client) return;
            await openSetupGuide(client);
          });
        });

        connectTabs.addEventListener('click', (event) => {
          const button = event.target.closest('button[data-connect-tab]');
          if (!button) return;
          setConnectTab(button.getAttribute('data-connect-tab') || 'quick');
        });

        setupSnippetTabs.addEventListener('click', (event) => {
          const button = event.target.closest('button[data-setup-format]');
          if (!button) return;
          selectSetupFormat(button.getAttribute('data-setup-format'));
        });

        setupCopyBtn.addEventListener('click', async () => {
          const payload = setupCopyBtn.dataset.payload || '';
          if (!payload) return;
          try {
            await navigator.clipboard.writeText(payload);
            setNotice('ok', 'Setup gekopieerd naar je klembord.');
          } catch (error) {
            setNotice('err', error instanceof Error ? error.message : 'Kopiëren is mislukt.');
          }
        });

        setupCloseBtn.addEventListener('click', closeSetupModal);
        setupDoneBtn.addEventListener('click', closeSetupModal);
        setupModalBackdrop.addEventListener('click', (event) => {
          if (event.target === setupModalBackdrop) {
            closeSetupModal();
          }
        });

        storeModalCloseBtn.addEventListener('click', closeStoreDetailsModal);
        storeModalDoneBtn.addEventListener('click', closeStoreDetailsModal);
        storeModalBackdrop.addEventListener('click', (event) => {
          if (event.target === storeModalBackdrop) {
            closeStoreDetailsModal();
          }
        });

        window.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape') return;
          if (setupModalBackdrop.classList.contains('open')) {
            closeSetupModal();
          }
          if (storeModalBackdrop.classList.contains('open')) {
            closeStoreDetailsModal();
          }
        });

        storeList.addEventListener('click', async (event) => {
          const button = event.target.closest('button[data-tenant-id]');
          if (!button) return;
          const tenantId = button.getAttribute('data-tenant-id') || '';
          if (!tenantId) return;
          try {
            await loadDashboard(tenantId);
            state.latestToken = '';
            openStoreDetailsModal(state.dashboard?.tenant || null);
            setNotice('ok', 'Actieve winkel is bijgewerkt.');
          } catch (error) {
            setNotice('err', error instanceof Error ? error.message : 'Wisselen van winkel mislukt.');
          }
        });

        activeConnections.addEventListener('click', async (event) => {
          const button = event.target.closest('button[data-revoke-connection]');
          if (!button) return;
          const connectionKey = button.getAttribute('data-revoke-connection') || '';
          if (!connectionKey || !state.selectedTenantId) return;
          const confirmed = window.confirm('Weet je zeker dat je deze AI-koppeling wilt intrekken?');
          if (!confirmed) return;
          button.disabled = true;
          try {
            const result = await api('/v1/dashboard/oauth/revoke', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                tenantId: state.selectedTenantId,
                connectionKey,
              }),
            });
            if (result.dashboard) {
              renderDashboard(result.dashboard);
            } else {
              await loadDashboard(state.selectedTenantId);
            }
            state.latestToken = '';
            setNotice('ok', 'Koppeling is ingetrokken.');
          } catch (error) {
            setNotice('err', error instanceof Error ? error.message : 'Intrekken is mislukt.');
          } finally {
            button.disabled = false;
          }
        });

        storeDeleteBtn.addEventListener('click', async () => {
          if (!state.selectedTenantId) return;
          const confirmed = window.confirm(
            'Weet je zeker dat je deze winkel wilt verwijderen? Actieve koppelingen voor deze winkel worden ingetrokken.'
          );
          if (!confirmed) return;
          storeDeleteBtn.disabled = true;
          try {
            const result = await api('/v1/dashboard/tenant/delete', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                tenantId: state.selectedTenantId,
              }),
            });
            state.latestToken = '';
            if (result.dashboard) {
              renderDashboard(result.dashboard);
            } else {
              await loadDashboard();
            }
            closeStoreDetailsModal();
            setNotice('ok', 'Winkel is verwijderd.');
          } catch (error) {
            setNotice('err', error instanceof Error ? error.message : 'Winkel verwijderen is mislukt.');
          } finally {
            storeDeleteBtn.disabled = !state.selectedTenantId;
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
          setNotice('ok', 'Dashboard klaar. Kies Snelle setup, Andere apps of Help.');
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
  authorizeAction = "/oauth/authorize",
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
              <div
                id="oauth-authorize-root"
                class="grid-2"
                style="display:grid;"
                data-authorize-path="${escapeHtml(authorizeAction || "/oauth/authorize")}"
                data-client-id="${escapeHtml(clientId)}"
                data-redirect-uri="${escapeHtml(redirectUri)}"
                data-state="${escapeHtml(state)}"
                data-response-type="${escapeHtml(responseType || "code")}"
                data-code-challenge="${escapeHtml(codeChallenge)}"
                data-code-challenge-method="${escapeHtml(codeChallengeMethod || "S256")}"
                data-scope="${escapeHtml(scope || "")}"
                data-default-shop-domain="${escapeHtml(shopOptions.length === 1 ? shopOptions[0] : "")}"
              >
                ${
                  hasMultipleShops
                    ? `
                <div class="field full">
                  <label for="shopDomain">Voor welke winkel wil je deze app gebruiken?</label>
                  <select id="shopDomain" name="shopDomain">${options}</select>
                </div>
                `
                    : ""
                }

                <div class="btn-row">
                  <button class="btn primary" type="button" data-decision="allow">Verbinden</button>
                  <button class="btn" type="button" data-decision="deny">Niet nu</button>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>
      <script>
        (() => {
          const root = document.getElementById('oauth-authorize-root');
          if (!root) return;

          const buildDecisionUrl = (decision) => {
            const params = new URLSearchParams();
            params.set('client_id', root.dataset.clientId || '');
            params.set('redirect_uri', root.dataset.redirectUri || '');
            params.set('state', root.dataset.state || '');
            params.set('response_type', root.dataset.responseType || 'code');
            params.set('code_challenge', root.dataset.codeChallenge || '');
            params.set('code_challenge_method', root.dataset.codeChallengeMethod || 'S256');
            params.set('scope', root.dataset.scope || 'mcp:tools');
            params.set('decision', decision);

            const shopSelect = document.getElementById('shopDomain');
            const selectedShop = shopSelect
              ? String(shopSelect.value || '').trim()
              : String(root.dataset.defaultShopDomain || '').trim();
            if (selectedShop) {
              params.set('shopDomain', selectedShop);
            }

            const basePath = root.dataset.authorizePath || '/oauth/authorize';
            const separator = basePath.includes('?') ? '&' : '?';
            return \`\${basePath}\${separator}\${params.toString()}\`;
          };

          root.querySelectorAll('[data-decision]').forEach((button) => {
            button.addEventListener('click', () => {
              const decision = button.dataset.decision === 'allow' ? 'allow' : 'deny';
              window.location.assign(buildDecisionUrl(decision));
            });
          });
        })();
      </script>
    `,
  });
}
