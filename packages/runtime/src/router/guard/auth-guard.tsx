import type { AppRouteRecordRaw } from "#src/router/types";
import { useEffect, useMemo } from "react";
import { matchRoutes, Navigate, useLocation, useNavigate } from "react-router";
import { fetchAsyncRoutes } from "#src/api/user";
import { useCurrentRoute } from "#src/hooks/use-current-route";
import { getRoutes as getModuleRoutes } from "#src/module-loader";
import { hideLoading } from "#src/plugins/hide-loading";
import { setupLoading } from "#src/plugins/loading";
import { exception403Path, exception404Path, exception500Path, loginPath } from "#src/router/extra-info";
import { accessRoutes, whiteRouteNames } from "#src/router/routes";
import { isSendRoutingRequest } from "#src/router/routes/config";
import { ensureBuiltinExceptionRoutes } from "#src/router/routes/core/exception";
import { generateRoutesFromBackend } from "#src/router/utils/generate-routes-from-backend";
import { generateRoutesByFrontend } from "#src/router/utils/generate-routes-from-frontend";
import { useAccessStore } from "#src/store/access";
import { useAuthStore } from "#src/store/auth";
import { usePreferencesStore } from "#src/store/preferences";

import { useUserStore } from "#src/store/user";
import { getRedirectPath } from "#src/utils/get-redirect-path";

import { removeDuplicateRoutes } from "./utils";

/**
 * @zh 路由白名单 1. 不进行权限校验， 2. 不会触发请求，例如用户信息接口
 * @en Routes whitelist 1. No permission verification, 2. Will not trigger requests, such as user information interface
 * @example "privacy-policy", "terms-of-service" and so on.
 */
const noLoginWhiteList = Array.from(whiteRouteNames).filter(item => item !== loginPath);

interface AuthGuardProps {
	children?: React.ReactNode
}

/**
 * @zh AuthGuard 组件，用于权限验证，代码的顺序很重要，不要随意调整
 * @en AuthGuard component, used for permission verification. The order of the code is important and should not be arbitrarily adjusted
 */
export function AuthGuard({ children }: AuthGuardProps) {
	const navigate = useNavigate();
	const currentRoute = useCurrentRoute();
	const { pathname, search } = useLocation();
	const isLogin = useAuthStore(state => Boolean(state.token));
	const isAuthorized = useUserStore(state => Boolean(state.id));
	const getUserInfo = useUserStore(state => state.getUserInfo);
	const userRoles = useUserStore(state => state.roles);
	const { setAccessStore, isAccessChecked, routeList } = useAccessStore();
	const { enableBackendAccess, enableFrontendAceess } = usePreferencesStore(state => state);

	/**
	 * 模块路由是经清单信任校验后加载的受信 bundle（P5.5/O5），与宿主用户体系
	 * 解耦：模块可独立运行，不依赖后端登录即可显示菜单、访问模块页面。
	 * 据此判断「当前路由是否为已加载模块路由」，用于下方鉴权门槛放行。
	 */
	const moduleRoutePaths = useMemo(
		() => new Set(getModuleRoutes().map(r => r.path).filter((p): p is string => Boolean(p))),
		[],
	);
	const isModuleRoute = useMemo(
		() => [...moduleRoutePaths].some(p => pathname === p || pathname.startsWith(`${p}/`)),
		[moduleRoutePaths, pathname],
	);

	const isPathInNoLoginWhiteList = noLoginWhiteList.includes(pathname);

	/**
	 * @zh 异步获取用户信息和路由配置
	 * @en Fetch user information and route configuration asynchronously
	 */
	useEffect(() => {
		async function fetchUserInfoAndRoutes() {
			/**
			 * @zh 登录跳转，防止闪烁
			 * @en Login redirect, prevent flicker
			 */
			setupLoading();

			/**
			 * @zh 初始化一个空数组来存放 Promise 对象
			 * @en Initialize an empty array to hold Promise objects
			 */
			const promises = [];

			/**
			 * @zh 获取用户信息
			 * @en Fetch user information
			 */
			promises.push(getUserInfo());

			/**
			 * @zh 启用了后端路由，且路由从单独接口中获取，则发起请求
			 * @en If backend routing is enabled and the route is obtained from a separate interface, then initiate a request
			 */
			if (enableBackendAccess && isSendRoutingRequest) {
				promises.push(fetchAsyncRoutes());
			}

			const results = await Promise.allSettled(promises);
			const [userInfoResult, routeResult] = results;
			const routes = [];
			const latestRoles = [];
			/**
			 * @zh 从用户接口中获取角色信息
			 * @en Fetch role information from the user interface
			 */
			if (userInfoResult.status === "fulfilled" && "roles" in userInfoResult.value) {
				latestRoles.push(...userInfoResult.value?.roles ?? []);
			}
			/**
			 * @zh 合并模块路由（优先于后端/前端路由）。模块已在应用启动时由 index.tsx
			 * 统一加载（P5.5/O5），守卫只消费已注册的路由，不触碰模块清单。
			 * @en Merge module routes (takes priority over backend/frontend routes).
			 * Modules are loaded once at app bootstrap (index.tsx, P5.5/O5); the guard
			 * only consumes already-registered routes and never touches the manifest.
			 */
			const moduleRoutes = getModuleRoutes(); // id 已在 getRoutes() 出口统一补齐（偏差 1）
			if (moduleRoutes.length > 0) {
				routes.push(...moduleRoutes);
			}

			/**
			 * @zh 收集模块已覆盖的顶级路径，用于过滤后端路由中的重复项
			 * @en Collect top-level paths already covered by modules to filter duplicates from backend routes
			 */
			const modulePaths = new Set(routes.map(r => r.path).filter(Boolean));

			const filterBackendRoutes = (backendRoutes: Array<AppRouteRecordRaw>) =>
				backendRoutes.filter(r => !modulePaths.has(r.path));

			/**
			 * @zh 启用了后端路由且路由从用户接口中获取
			 * @en If backend routing is enabled and the route is obtained from the user interface
			 */
			if (enableBackendAccess && !isSendRoutingRequest && userInfoResult.status === "fulfilled" && "menus" in userInfoResult.value) {
				routes.push(...await generateRoutesFromBackend(filterBackendRoutes(userInfoResult.value?.menus ?? [])));
			}
			/**
			 * @zh 启用了后端路由且路由从单独接口中获取
			 * @en If backend routing is enabled and the route is obtained from a separate interface
			 */
			if (enableBackendAccess && isSendRoutingRequest && routeResult.status === "fulfilled" && Array.isArray(routeResult.value)) {
				// AC-D16：fetchAsyncRoutes 直返路由数组，无 .result 信封
				routes.push(...await generateRoutesFromBackend(filterBackendRoutes(routeResult.value)));
			}

			/**
			 * @zh 启用了前端路由
			 * @en If frontend routing is enabled
			 */
			if (enableFrontendAceess) {
				routes.push(...generateRoutesByFrontend(accessRoutes, latestRoles));
			}

			/**
			 * P7.14 / 评审 F11：/exception/403|404|500 是守卫的硬编码跳转目标，
			 * 属框架契约——任何来源（模块/后端/前端）未覆盖时注入框架内置兜底页，
			 * 避免禁用 exception 模块后跳转落 catch-all 显示 404。
			 */
			const uniqueRoutes = removeDuplicateRoutes(ensureBuiltinExceptionRoutes(routes));
			setAccessStore(uniqueRoutes);

			const hasError = results.some(result => result.status === "rejected");
			/**
			 * @zh 网络请求失败，跳转到 500 页面
			 * @en Network request failed, redirect to 500 page
			 */
			if (hasError) {
				const unAuthorized = results.some((result: any) => result.reason.response.status === 401);
				if (!unAuthorized) {
					return navigate(exception500Path);
				}
			}

			/**
			 *
			 * @zh 开启动态路由条件下需要替换当前路由？
			 * 1. 浏览器导航进入动态路由地址，例如 /system/user
			 * 2. 动态路由未添加到路由，所以地址栏中依然是 /system/user 但匹配到的路由是 fallback (path = "*") 路由
			 * 3. 添加完动态路由后，使用 replace 替换当前路由，触发程序重新匹配到 /system/user 路由
			 *
			 * Refer：https://router.vuejs.org/guide/advanced/dynamic-routing#Adding-routes
			 *
			 * @en Under the condition of dynamic routing, do you need to replace the current route?
			 * 1. Browser navigation into a dynamic routing address, such as /system/user
			 * 2. The dynamic route is not added to the route, so the address bar is still /system/user but the matched route is the fallback (path = "*") route
			 * 3. After adding the dynamic route, use replace to replace the current route and trigger the program to match /system/user again
			 */
			navigate(`${pathname}${search}`, {
				replace: true,
				/**
				 * @zh 保证替换路由前不会显示 404 页面（登录页面，网速切换为 3G 会闪烁显示 404 页面）
				 * @en Ensure that the 404 page will not be displayed before replacing the route
				 */
				flushSync: true,
			});
		}
		/**
		 * @zh 只有在以下条件下才执行获取用户信息和路由的逻辑
		 * 1. 非路由白名单
		 * 2. 已登录
		 * 3. 未获取到用户信息和路由信息
		 *
		 * @en The logic of obtaining user information and routes is only executed under the following conditions
		 * 1. Not in the route whitelist
		 * 2. Logged in
		 * 3. Unable to obtain user information and route information
		 *
		 */
		/**
		 * 模块路由解耦注册：模块加载后即把模块路由并入菜单/路由表，使菜单与
		 * 模块页面在「无后端鉴权」的模块独立运行场景下立即可用（playground /
		 * ojm dev）。模块是受信 bundle，无需等待后端 userInfo。已注册则跳过，
		 * 避免每次路由变更重复合并。生产自身路由仍由下方登录分支拉取。
		 */
		const moduleRoutes = getModuleRoutes(); // id 已在 getRoutes() 出口统一补齐（偏差 1）
		if (moduleRoutes.length > 0) {
			const existing = useAccessStore.getState().routeList;
			const alreadyRegistered = moduleRoutes.every(m => existing.some(r => r.path === m.path));
			if (!alreadyRegistered) {
				setAccessStore(moduleRoutes);
			}
		}

		if (!whiteRouteNames.includes(pathname) && isLogin && !isAuthorized) {
			fetchUserInfoAndRoutes();
		}
	}, [pathname, isLogin, isAuthorized]);

	/**
	 * @zh 路由白名单
	 * @en Route whitelist
	 * @see {noLoginWhiteList}
	 */
	if (isPathInNoLoginWhiteList) {
		hideLoading();
		return children;
	}

	/**
	 * @zh 未登录条件下的处理逻辑
	 * @en Processing logic under unlogged conditions
	 */
	/* --------------- Start ------------------ */
	if (!isLogin) {
		hideLoading();
		/**
		 * 受信模块路由：无需登录即可访问（模块与宿主用户体系解耦），直接放行，
		 * 不再重定向到登录页。生产自身路由仍走下方登录重定向逻辑。
		 */
		if (isModuleRoute) {
			return children;
		}
		// 未登录且目标页不是登录页，则跳转到登录页
		if (pathname !== loginPath) {
			// pathname 长度大于 1，则携带当前路径跳转登录页，否则直接跳转登录页
			const redirectPath = pathname.length > 1 ? `${loginPath}?redirect=${pathname}${search}` : loginPath;
			return (
				<Navigate
					to={redirectPath}
					replace
				/>
			);
		}
		// 未登录且目标页是登录页，保留登录页
		else {
			return children;
		}
	}
	/* --------------- End ------------------ */

	/**
	 * @zh 登录条件下的处理逻辑
	 * @en Processing logic under logged conditions
	 */
	/* --------------- Start ------------------ */

	/**
	 * @zh 已登录条件下，匹配 login 路由，跳转到首页
	 * 放到用户信息前，因为 login 路由不会请求用户信息，所以放在前面判断
	 *
	 * @en Under logged conditions, match the login route and jump to the home page
	 * Put it before user information, because the login route will not request user information, so put it in front to judge
	 */
	if (pathname === loginPath) {
		/**
		 * @example login?redirect=/system/user
		 * redirect 解析统一走 getRedirectPath 出口（P3）：非法/外部地址回落首页
		 */
		const redirectPath = getRedirectPath(search);
		if (redirectPath !== pathname) {
			return (
				<Navigate
					to={redirectPath}
					replace
				/>
			);
		}
		return (
			<Navigate
				to={import.meta.env.VITE_BASE_HOME_PATH}
				replace
			/>
		);
	}

	/**
	 * @zh 等待获取用户信息
	 * @en  Waiting for user information to be obtained
	 */
	if (!isAuthorized && !isModuleRoute) {
		return null;
	}
	/**
	 * @zh 等待获取路由信息
	 * @en Waiting for route information to be obtained
	 */
	if (!isAccessChecked && !isModuleRoute) {
		return null;
	}

	/**
	 * @zh 隐藏加载动画
	 * @en Hide loading animation
	 */
	hideLoading();

	/**
	 * @zh 如果是根路由则跳转到首页（获取完用户信息之后跳转到默认首页，防止请求两次用户信息接口）
	 * @en If it is the root route, jump to the home page (jump to the default home page after obtaining user information to prevent requesting twice for user information interface)
	 * @zh pathname 返回的是相对 import.meta.env.BASE_URL 的路径，所以这里是相对于 BASE_URL 的根路由 "/"
	 * @en pathname returns the path relative to import.meta.env.BASE_URL, so here is the root route "/" relative to BASE_URL
	 */
	if (pathname === "/") {
		return (
			<Navigate
				to={import.meta.env.VITE_BASE_HOME_PATH}
				replace
			/>
		);
	}

	/* --------------- End ------------------ */

	/**
	 * @zh 路由权限校验逻辑
	 * @en Route permission verification logic
	 */
	const routeRoles = currentRoute?.handle?.roles;
	const ignoreAccess = currentRoute?.handle?.ignoreAccess;

	/**
	 * @zh 忽略权限校验
	 * @en Ignore permission verification
	 */
	if (ignoreAccess === true) {
		return children;
	}

	const matches = matchRoutes(
		routeList,
		pathname,
		/**
		 * @zh pathname 返回的是相对 import.meta.env.BASE_URL 的路径，所以不需要指定第三个参数 basename 了
		 * @en pathname returns the path relative to import.meta.env.BASE_URL, so there is no need to specify the third parameter basename
		 */
	) ?? [];

	const hasChildren = matches[matches.length - 1]?.route?.children?.filter(item => !item.index)?.length;
	/**
	 * @zh 如果当前路由有子路由，则跳转到 404 页面
	 * @en If the current route has sub-routes, jump to the 404 page
	 */
	if (hasChildren && hasChildren > 0) {
		return (
			<Navigate
				to={exception404Path}
				replace
			/>
		);
	}

	/**
	 * @zh 角色权限校验
	 * @en Role permission verification
	 */
	const hasRoutePermission = userRoles.some(role => routeRoles?.includes(role));
	/**
	 * @zh 权限校验逻辑：
	 * 1. 如果路由上没有携带 roles，视为无权限路由，等同于 ignoreAccess 为 true
	 * 2. 未通过权限校验的路由，取消当前路由导航，并转到 403 页面
	 *
	 * @en Role permission verification logic:
	 * 1. If there is no role on the route, it is considered as a permissionless route, equivalent to ignoreAccess being true
	 * 2. For routes that do not pass permission verification, cancel the current route navigation and jump to the 403 page
	 */
	if (routeRoles && routeRoles.length && !hasRoutePermission) {
		return (
			<Navigate
				to={exception403Path}
				replace
			/>
		);
	}

	return children;
}
/**
 * 验证路由跳转是否正确的步骤：
 * 1. 未登录情况下，输入 login 路由
 * 2. 未登录情况下，输入非 login 路由
 * 3. 已登录情况下，使用系统的退出登录，然后再次登录
 * 4. 任选一个非 home 页面，使用开发者工具清除 localStorage，刷新页面之后进行登录
 * 5. 已登录情况下，输入 login 路由
 * 6. 已登录情况下，输入非 login 路由
 * 7. 已登录情况下，输入 http://localhost:3333 跳转到 /home 路由，用户接口发送一次
 * 8. 已登录情况下，输入 http://localhost:3333/ 跳转到 /home 路由，用户接口发送一次
 * 9. 已登录情况下，输入 http://localhost:3333/home 跳转到 /home 路由，用户接口发送一次
 */
