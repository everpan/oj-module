<div align="center">
	<a href="https://github.com/condorheroblog/react-antd-admin/">
		<img alt="React-antd-admin Logo" width="192" src="https://github.com/user-attachments/assets/1de76309-4cf5-4e34-a32f-92c361bace2a">
	</a>
	<br />
	<h1>React Antd Admin</h1>
	<br />
</div>

![GitHub license](https://img.shields.io/github/license/condorheroblog/react-antd-admin?style=flat)
![GitHub stars](https://img.shields.io/github/stars/condorheroblog/react-antd-admin?color=fa6470&style=flat)
![GitHub forks](https://img.shields.io/github/forks/condorheroblog/react-antd-admin?style=flat)

**English** | [中文](./README.zh-CN.md)

## Introduction

react-antd-module is a modular, middle-and-back-office solution built on top of [`react-antd-admin`](https://github.com/condorheroblog/react-antd-admin/). It helps you quickly scaffold enterprise-grade middle-and-back-office projects and is suited to multi-team development organized by domain modules.

## Features

- Cutting-edge tech stack: [React Hooks](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/), [ant design](https://ant.design/index-cn/), [React Router](https://reactrouter.com/), [Tailwind CSS](https://tailwindcss.com/docs/installation)
- Intuitive state management: [Zustand](https://zustand-demo.pmnd.rs/)
- Internationalization: [I18n](https://react.i18next.com/)
- Fetch requests: [Ky](https://github.com/sindresorhus/ky), [@tanstack/react-query](https://tanstack.com/query/latest/docs/framework/react/overview)
- Code formatting: [ESLint Flat Config](https://eslint.org/docs/latest/use/configure/configuration-files-new/)
- Route-level component caching: [keepalive-for-react](https://github.com/irychen/keepalive-for-react)
- API mocking: [vite-plugin-fake-server](https://github.com/condorheroblog/vite-plugin-fake-server)
- **Modular architecture**: business pages are organized as independent modules that can be developed and released independently
- Permission routing: supports both frontend static routing and backend dynamic routing, with three-level access control (route / menu / button)
- Theme configuration: built-in multiple theme configurations, supports dark theme, unified color system for Ant Design and Tailwind CSS
- Modular loading with version management

## Core Features Brought by Modularization

1. Runtime remote module loading (business decoupled from the host)
   The host (shell) no longer bundles any business code — it only "loads modules + renders the container". Business modules declare their metadata via `defineModule`, and `loadAll(manifest)` lazily fetches the registered `/modules/<name>/<version>/entry.js` from `modules.json` at runtime. Modules can be developed, deployed, and versioned independently; the host and business are fully decoupled and never block each other's release cadence.

2. Shared-dependency single instance (importmap + single-instance constraint)
   `react` / `react-dom` / `antd` / `@ant-design/pro-components` / `runtime` and other shared dependencies are externalized at build time by `generateImportmap()` into exact `importmap` keys. Both the host and every module resolve through the same ESM asset, guaranteeing a single instance site-wide. This fundamentally eliminates the classic micro-frontend pitfalls of "multiple React / multiple antd instances" — broken context, failed hooks, and `findDOMNode` warnings.

3. Clear host/business layout boundary (no double nesting)
   The host route root only renders `<Outlet/>`; the entire site chrome (sidebar / header / tabs / menu) is provided entirely by the module's own `ContainerLayout` (`host.tsx` deliberately does not overlay a host sidebar). After modularization, "the framework only manages the container, the module manages all presentation" — there is no chaotic double-nested layout of host sidebar + module sidebar, and theme / dark mode / navigation mode are unified by the module, consistent with the App chain.

4. Build-time dependency closure + export-completeness gate (white screen shifted left)
   `autoGenerateSubpathAssets` uses fixed-point iteration to automatically discover deep-path bare specifiers inside shared assets (e.g. `antd/es/modal`, `dayjs/locale/zh-cn`) and build "re-export-from-parent" subpath assets on the fly (this `antd/es/*` fix is exactly this mechanism). The `assertSharedExportsComplete` gate intercepts three classes of white-screen root causes at build time: missing named exports, `Failed to resolve module specifier`, and un-shimmed dynamic `require`. Entire runtime white screens are shifted left to a build-time failure that CI blocks directly.

5. Security in depth (trust root + L2 integrity + CSP)
   - Trust root: `assertTrustedModules` validates `modules.json` against a source whitelist before loading / preloading / injecting CSS;
   - L2 integrity: non-lazy chunks are preloaded carrying build-time `sha384` integrity + `modulepreload`, verified by the browser before load;
   - CSP: the `importmap` and `<meta http-equiv="Content-Security-Policy">` are injected with a random `nonce`, rotated on every build.
   The modular loading chain is controlled on three layers: who may be loaded, whether the load is tampered with, and whether it is injected.

6. Version-matrix gate and peerRuntime contract (anti-drift)
   `checkSharedVersions` compares the host's `versions.json` against each module's `peerRuntime`; shared-dependency version drift is rejected outright at the `ram build` stage. Modules and host align via a "version contract", avoiding the hidden incompatibility of "host upgraded antd while the module still runs the old antd single instance".

7. Heterogeneous auth-backend adaptation (normalization, zero module changes)
   The request layer `request/index.ts` uses a whitelist (`isAnonymousApi` / `anonymousApiPrefix`) to distinguish anonymous channels; it normalizes envelopes uniformly (oj's `code/data/access_token` snake_case → `code/result/token` camelCase), so consumers (auth-guard, refresh, user store) integrate different auth backends with zero changes. Modules may also register their own auth provider, with the framework falling back to the built-in `auth/login` — auth capability is decoupled from the modular system.

8. Type-driven module contract (strongly-typed `defineModule`)
   A module entry strongly types its declaration via `defineModule({ name, version, routes, config, lifecycle, apiPrefix })`; routes, i18n, lifecycle, and dependencies are constrained at compile time. Modules never import each other — they communicate only through the contract, which naturally supports the "repository-level modules (`/modules/*`) dogfooding alongside in-project modules (`modules/src`)" development model.

9. Defensive, charset-agnostic request layer (robustness as a decoupling win)
   The `setHeaderSafe` wrapper added in this fix automatically percent-encodes non-Latin1 values such as `Authorization` / `X-Lang`, making ky's header setting charset-agnostic — modules passing any language / username will never crash the request interceptor. This "framework-level兜底, business-unaware" defensive design means module developers need not care about the host runtime's charset / header boundaries.

---

In one sentence: after the modularization refactor, the project forms a micro-frontend architecture of "host only as container, self-contained modules, single shared-dependency instance, build-time closed-loop verification, trustworthy and verifiable loading chain, and normalizable auth adaptation" — business modules are highly decoupled from the framework and from each other, and a large class of runtime white-screen / security / version risks are shifted left to the build stage and the contract layer.

## Modular Architecture

Feature pages are organized as independent modules under `modules/`. Each module is self-contained with its own routes, pages, i18n resources, and lifecycle hooks.

```
modules/
├── home/              # Home page module
│   ├── entry.ts       # Single source of truth: name, version, routes, i18n
│   ├── pages/         # Page components
│   └── locales/       # i18n resources (zh-CN.json, en-US.json)
├── system/            # System management (user, role, menu, dept)
├── access/            # Permission demo pages
├── about/             # About page
└── ...
```

**Key benefits:**

- **Independent development** — Modules are decoupled from the framework and from each other
- **Independent release** — Each module can be built and published separately via `pnpm build:modules`
- **Dynamic registration** — Enable/disable modules via `manifest.json` without code changes
- **Route priority** — Module routes take precedence over backend dynamic routes; overlapping paths are automatically filtered
- **Quick scaffolding** — Run `pnpm create-module` to generate a new module with an interactive wizard

## Preview

[react-antd-admin](https://condorheroblog.github.io/react-antd-admin/)

## Documentation

[react-antd-admin Documentation](https://condorheroblog.github.io/react-antd-admin/docs/)

## Usage

### GitHub Template

[Create a repository using this template](https://github.com/new?template_name=react-antd-admin&template_owner=condorheroblog)

### Clone the project

If you prefer a template without git history, manually execute the following:

```bash
npx degit condorheroblog/react-antd-admin react-antd-admin
# or npx giget@latest gh:condorheroblog/react-antd-admin react-antd-admin
cd react-antd-admin
corepack enable
pnpm i # If you haven't installed pnpm before, run: npm install -g pnpm
```

### Development

```bash
corepack enable

pnpm install
```

### Run

```bash
pnpm run dev
```

Open your browser and enter [http://localhost:3333](http://localhost:3333) to see the page.

### Create a new module

```bash
pnpm create-module
```

This launches an interactive wizard that scaffolds a new module under `modules/` with entry.ts, pages directory, and i18n resources.

### Build modules independently

```bash
pnpm build:modules
```

Builds each enabled module from `manifest.json` into the `dist-modules/` directory.

## Build

```bash
pnpm build
```

The build output is by default in the build folder.

## Preview

```bash
pnpm preview
```

## Security & Publishing (P6)

### Residual risk R13 (explicit)

The manifest is hosted as a same-origin static file and is **not signed** (O3 already decided: same org, different teams — the cost of signing outweighs the benefit). The trust root degrades to "single CI egress + manifest and artifacts in separate directories with separate publish credentials + `moduleOrigins` source whitelist + L2 integrity + CSP". **Residual risk accepted: credentials that can write to the manifest directory are equivalent to being able to inject arbitrary module code** — ensure only CI can write to the manifest directory.

### Publish checklist (@oj-module/runtime / cli)

- Installation uses `.npmrc` mirror acceleration; **publishing** is locked to the official registry via each package's `publishConfig.registry` to prevent mis-publishing
- Enable **2FA** on the npm account (account settings, one-time)
- Unified publish command: `pnpm --filter @oj-module/<pkg> publish --provenance --access public`
- CI install unified as `pnpm install --frozen-lockfile`; lockfile changes must pass review
- Periodically run `npm audit signatures` to verify the dependency signature chain
- Anti-typosquat: external teams should verify the `@oj-module/*` scope spelling when installing (official source is the only publisher)

## Credits

Thanks to the following excellent projects for providing inspiration:

- [vue-vben-admin](https://github.com/vbenjs/vue-vben-admin) for design inspiration
- [vue-pure-admin](https://github.com/pure-admin/vue-pure-admin) for business logic inspiration

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=condorheroblog/react-antd-admin&type=Date)](https://star-history.com/#condorheroblog/react-antd-admin&Date)

## Sponsor

If this project was helpful to you, you can buy the author a takeaway meal.

![Sponsor](https://camo.githubusercontent.com/b61a54a08ff3a1392f191016d6c0d7537559bb4fa19ae1d27fadfd1de5796289/68747470733a2f2f636f6e646f726865726f626c6f672e6769746875622e696f2f72656163742d616e74642d61646d696e2f646f63732f73706f6e736f722e706e67)

## License

[MIT](https://github.com/condorheroblog/react-antd-admin/blob/main/LICENSE) License © 2023-Present [Condor Hero](https://github.com/condorheroblog)
