import type { UploadPackageResult } from "../../types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Space, Tag, Typography, Upload } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMarketClient } from "../../api/context";
import { errorText } from "./model";

/**
 * 发布管理「离线包上传」区（2026-11-10 round 3）：内网手动上传升级——运维持已签分发包
 * （tgz + .sig 旁车）上传入库，服务端即时配对验签（旁车与包体字节绑定）。发布方指纹
 * 未入库的包也放行入库（trusted=false 如实展示），安装时才做信任判定（TOFU 闭环）。
 *
 * 可见范围由服务端决定：发布页对普通用户开放（凭证自管），本区 superadmin 专属——
 * 以 GET /oj-market/trust（superadmin 独占）为探测面，403 整区不渲染、未决不闪现
 * （同信任审核区口径，前端不重复判权）。
 */
export function OfflineUploadSection() {
	const { t } = useTranslation();
	const client = useMarketClient();
	const [tgz, setTgz] = useState<File | null>(null);
	const [sig, setSig] = useState<File | null>(null);
	const [formError, setFormError] = useState("");
	const probe = useQuery({
		queryKey: ["publish", "trust-keys"],
		queryFn: () => client.trustKeys(),
		retry: false,
	});
	const upload = useMutation({
		mutationFn: (input: { name: string, tgz: Blob, sig: Blob }) => client.uploadPackage(input),
	});

	// 探测未决/失败（403 或其它）一律不渲染——上传面不应给无权者留可操作假象
	if (!probe.isSuccess)
		return null;

	const pick = (which: "tgz" | "sig") => (file: File) => {
		if (which === "tgz")
			setTgz(file);
		else
			setSig(file);
		setFormError("");
		return false;
	};

	const submit = () => {
		setFormError("");
		if (tgz === null || sig === null) {
			setFormError(t("publish:offlineUpload.needBoth"));
			return;
		}
		if (sig.name !== `${tgz.name}.sig`) {
			setFormError(t("publish:offlineUpload.pairMismatch", { tgz: tgz.name }));
			return;
		}
		upload.mutate({ name: tgz.name, tgz, sig });
	};

	const resultOf = (r: UploadPackageResult) => (
		<div>
			<div>
				{t("publish:trustReview.colKeyId")}
				：
				<Typography.Text code>{r.key_id}</Typography.Text>
			</div>
			<div>
				{t("publish:trustReview.colFingerprint")}
				：
				<Typography.Text code copyable={{ text: r.fingerprint }}>{r.fingerprint}</Typography.Text>
			</div>
			<div style={{ marginTop: 4 }}>
				{r.trusted
					? <Tag color="green">{t("publish:offlineUpload.trusted")}</Tag>
					: <Tag color="orange">{t("publish:offlineUpload.untrusted")}</Tag>}
				{r.idempotent && <Tag>{t("publish:offlineUpload.idempotent")}</Tag>}
			</div>
		</div>
	);

	return (
		<section data-testid="offline-upload" style={{ marginTop: 24 }}>
			<Typography.Title level={5} style={{ marginTop: 0 }}>{t("publish:offlineUpload.title")}</Typography.Title>
			<Typography.Paragraph type="secondary">{t("publish:offlineUpload.desc")}</Typography.Paragraph>
			{(formError !== "" || upload.isError) && (
				<Alert type="error" showIcon style={{ marginBottom: 12 }} message={formError !== "" ? formError : errorText(upload.error)} />
			)}
			<Space wrap align="end" style={{ marginBottom: 12 }}>
				<div>
					<Typography.Text type="secondary">{t("publish:offlineUpload.tgzLabel")}</Typography.Text>
					<div>
						<Upload
							maxCount={1}
							fileList={tgz === null ? [] : [{ uid: "tgz", name: tgz.name, status: "done" }]}
							beforeUpload={pick("tgz")}
							onRemove={() => setTgz(null)}
						>
							<Button size="small">{t("publish:offlineUpload.selectFile")}</Button>
						</Upload>
					</div>
				</div>
				<div>
					<Typography.Text type="secondary">{t("publish:offlineUpload.sigLabel")}</Typography.Text>
					<div>
						<Upload
							maxCount={1}
							fileList={sig === null ? [] : [{ uid: "sig", name: sig.name, status: "done" }]}
							beforeUpload={pick("sig")}
							onRemove={() => setSig(null)}
						>
							<Button size="small">{t("publish:offlineUpload.selectFile")}</Button>
						</Upload>
					</div>
				</div>
				<Button type="primary" loading={upload.isPending} disabled={tgz === null || sig === null} onClick={submit}>
					{t("publish:offlineUpload.submit")}
				</Button>
			</Space>
			{upload.data && (
				<Alert
					type={upload.data.trusted ? "success" : "warning"}
					showIcon
					style={{ marginTop: 4 }}
					message={`${upload.data.name}@${upload.data.version}`}
					description={resultOf(upload.data)}
				/>
			)}
		</section>
	);
}
