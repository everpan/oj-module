import type { ActionType, ProColumns, ProCoreActionType } from "@ant-design/pro-components";
import type { MenuItemType } from "@react-antd-module/runtime";
import { PlusCircleOutlined } from "@ant-design/icons";

import { accessControlCodes, BasicButton, BasicContent, BasicTable, fetchDeleteMenuItem, fetchMenuList, handleTree, useAccess } from "@react-antd-module/runtime";
import { Button, Popconfirm } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Detail } from "./components/detail";
import { getConstantColumns } from "./constants";

export default function Menu() {
	const { t } = useTranslation();
	const { hasAccessByCodes } = useAccess();
	/* Detail Data */
	const [isOpen, setIsOpen] = useState(false);
	const [title, setTitle] = useState("");
	const [detailData, setDetailData] = useState<Partial<MenuItemType>>({});
	const [flatParentMenus, setFlatParentMenus] = useState<MenuItemType[]>([]);

	const actionRef = useRef<ActionType>(null);

	const handleDeleteRow = async (id: number, action?: ProCoreActionType<object>) => {
		const deletedId = await fetchDeleteMenuItem(id);
		await action?.reload?.();
		window.$message?.success(`${t("common.deleteSuccess")} id = ${deletedId}`);
	};

	const columns: ProColumns<MenuItemType>[] = [
		...getConstantColumns(t),
		{
			title: t("common.action"),
			valueType: "option",
			key: "option",
			width: 120,
			fixed: "right",
			render: (text, record, _, action) => {
				return [
					<BasicButton
						key="editable"
						type="link"
						size="small"
						disabled={!hasAccessByCodes(accessControlCodes.update)}
						onClick={async () => {
							setIsOpen(true);
							setTitle(t("system:menu.editMenu"));
							setDetailData({ ...record });
						}}
					>
						{t("common.edit")}
					</BasicButton>,
					<Popconfirm
						key="delete"
						title={t("common.confirmDelete")}
						onConfirm={() => handleDeleteRow(record.id, action)}
						okText={t("common.confirm")}
						cancelText={t("common.cancel")}
					>
						<BasicButton type="link" size="small" disabled={!hasAccessByCodes(accessControlCodes.delete)}>{t("common.delete")}</BasicButton>
					</Popconfirm>,
				];
			},
		},
	];

	const onCloseChange = () => {
		setIsOpen(false);
		setDetailData({});
	};

	const refreshTable = () => {
		actionRef.current?.reload();
	};

	return (
		<BasicContent className="h-full">
			<BasicTable<MenuItemType>
				adaptive
				columns={columns}
				actionRef={actionRef}
				request={async (params) => {
					// console.log(sort, filter);
					const { list, total } = await fetchMenuList(params);
					const menuTree = handleTree(list);
					setFlatParentMenus(
						list
							.filter(
								item => Number(item.menuType) === 0,
							).map(item => ({ ...item, name: t(item.name) })),
					);
					return {
						data: menuTree,
						total,
					};
				}}
				headerTitle={`${t("system:menu.menu")} （${t("common.demoOnly")}）`}
				toolBarRender={() => [

					<Button
						key="add-role"
						icon={<PlusCircleOutlined />}
						type="primary"
						disabled={!hasAccessByCodes(accessControlCodes.add)}
						onClick={() => {
							setIsOpen(true);
							setTitle(t("system:menu.addMenu"));
						}}
					>
						{t("common.add")}
					</Button>,

				]}
			/>
			<Detail
				title={title}
				open={isOpen}
				flatParentMenus={flatParentMenus}
				onCloseChange={onCloseChange}
				detailData={detailData}
				refreshTable={refreshTable}
			/>
		</BasicContent>
	);
};
