import { SmileOutlined } from "@ant-design/icons";
import { Result } from "antd";
import { useTranslation } from "react-i18next";

export default function AdminVisible() {
	const { t } = useTranslation();

	return (
		<Result
			icon={<SmileOutlined />}
			status="success"
			title={t("access:adminVisible.title")}
			subTitle={t("access:adminVisible.description")}
		/>
	);
}
