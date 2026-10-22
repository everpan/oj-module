import { useUserStore } from "@oj-module/runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Checkbox, Space } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useNavigate, useParams } from "react-router";

import { systemRolesGet, systemUsersGet, systemUsersRolesPut } from "../../__client/api";
import { explainError, isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";

/**
 * 成员资格（AC1-7，superadmin-only）：整集替换某用户角色。后端无 GET 单用户端点，
 * 当前角色从 GET /system/users 列表按 uid 回显；写走 PUT /system/users/roles?uid=。
 * admin（非 superadmin）手输 URL 进入后提交会被 service 层 403 → 页面渲染无权限（§3.2）。
 */
export default function UserRolesPage() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const navigate = useNavigate();
	const { uid } = useParams();
	const queryClient = useQueryClient();
	const me = useUserStore(s => s.id);

	// null = 尚未改动，回显服务端值；一旦勾选即持本地整集
	const [selected, setSelected] = useState<string[] | null>(null);

	const usersQuery = useQuery({ queryKey: ["system", "users"], queryFn: systemUsersGet });
	const rolesQuery = useQuery({ queryKey: ["system", "roles"], queryFn: systemRolesGet });

	const saveMut = useMutation({
		mutationFn: (roles: string[]) => systemUsersRolesPut({ query: { uid: Number(uid) }, body: { roles } }),
		onSuccess: () => {
			message.success(t("system:userRoles.saved"));
			queryClient.invalidateQueries({ queryKey: ["system", "users"] });
			navigate("/system/users");
		},
		// 403 全局 toast 已被请求层抑制，页面须自行反馈（admin 非 superadmin 手输 URL 的场景）
		onError: e => message.error(explainError(e, t)),
	});

	const user = usersQuery.data?.find(u => String(u.id) === uid);
	if (usersQuery.error && isForbidden(usersQuery.error))
		return <ForbiddenPanel t={t} error={usersQuery.error} />;

	const value = selected ?? user?.roles ?? [];
	const isSelf = String(user?.id) === me;

	return (
		<Card title={`${t("system:userRoles.title")}: ${user?.username ?? `#${uid}`}`}>
			<Space direction="vertical">
				<Checkbox.Group
					options={(rolesQuery.data ?? []).map(r => ({ label: `${r.name}${r.deprecated ? "（已废弃）" : ""}`, value: r.name }))}
					value={value}
					onChange={v => setSelected(v)}
				/>
				{value.length === 0 ? <span>{t("system:userRoles.none")}</span> : null}
				<Button
					type="primary"
					disabled={isSelf || selected === null}
					loading={saveMut.isPending}
					onClick={() => saveMut.mutate(value)}
				>
					{t("system:common.save")}
				</Button>
			</Space>
		</Card>
	);
}
