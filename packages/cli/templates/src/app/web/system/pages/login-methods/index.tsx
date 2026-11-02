import { useQuery } from "@tanstack/react-query";
import { Card, Descriptions, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { systemLoginMethodsGet } from "../../__client/api";

const METHOD_KEY: Record<string, string> = {
	local: "system:loginMethodsPage.methodLocal",
	ldap: "system:loginMethodsPage.methodLdap",
	sso: "system:loginMethodsPage.methodSso",
	wecom: "system:loginMethodsPage.methodWecom",
};

/** 登录方式发现（C5/D2，只读）：local 恒在，ldap/sso/wecom 由设置项开关。 */
export default function LoginMethodsPage() {
	const { t } = useTranslation();
	const query = useQuery({ queryKey: ["system", "login-methods"], queryFn: systemLoginMethodsGet });

	return (
		<Card loading={query.isLoading} title={t("system:loginMethodsPage.title")}>
			<Descriptions column={1}>
				<Descriptions.Item label={t("system:menu.loginMethods")}>
					{(query.data?.methods ?? []).map(m => (
						<Tag key={m}>{METHOD_KEY[m] ? t(METHOD_KEY[m]) : m}</Tag>
					))}
				</Descriptions.Item>
			</Descriptions>
		</Card>
	);
}
