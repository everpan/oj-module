import type { TreeProps } from "antd";

import type { BasicDataNode } from "antd/lib/tree";
import { Checkbox, Input, Tree } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export interface TreeDataNodeWithId extends BasicDataNode {
	id: string
	title: string
	children: TreeDataNodeWithId[]
}

interface FormTreeItemProps {
	treeData: TreeDataNodeWithId[]
	value?: React.Key[]
	onChange?: (value: React.Key[]) => void
}

const { Search } = Input;

function getParentKey(key: React.Key, tree: TreeDataNodeWithId[]): React.Key {
	let parentKey: React.Key;
	for (let i = 0; i < tree.length; i++) {
		const node = tree[i];
		if (node.children) {
			if (node.children.some(item => item.id === key)) {
				parentKey = node.id;
			}
			else if (getParentKey(key, node.children)) {
				parentKey = getParentKey(key, node.children);
			}
		}
	}
	return parentKey!;
}

export function FormTreeItem({ treeData, value, onChange }: FormTreeItemProps) {
	const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
	const [searchValue, setSearchValue] = useState("");
	const [checkedOptions, setCheckedOptions] = useState<string[]>([]);
	const [autoExpandParent, setAutoExpandParent] = useState(true);
	const { t } = useTranslation();

	// const onSelect: TreeProps["onSelect"] = (selectedKeys) => {
	// 	onChange?.(selectedKeys);
	// };

	const onCheck: TreeProps["onCheck"] = (checkedKeys) => {
		onChange?.(checkedKeys as React.Key[]);
	};

	const onExpand = (newExpandedKeys: React.Key[]) => {
		setExpandedKeys(newExpandedKeys);
		setAutoExpandParent(false);
	};

	const flattenTreeData = useMemo(() => {
		const dataList: { id: React.Key, title: string }[] = [];
		const generateList = (data: TreeDataNodeWithId[]) => {
			for (let i = 0; i < data.length; i++) {
				const node = data[i];
				dataList.push({ id: node.id, title: node.title as string });
				if (node.children) {
					generateList(node.children);
				}
			}
		};
		generateList(treeData);

		return dataList;
	}, [treeData]);

	const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const { value } = e.target;
		const newExpandedKeys = flattenTreeData
			.map((item) => {
				if (t(item.title).includes(value)) {
					return getParentKey(item.id, treeData);
				}
				return null;
			})
			.filter((item, i, self): item is React.Key => !!(item && self.indexOf(item) === i));
		setExpandedKeys(newExpandedKeys);
		setSearchValue(value);
		setAutoExpandParent(true);
	};

	const onCheckboxChange = (checkedValues: string[]) => {
		setCheckedOptions(checkedValues);
	};

	useEffect(() => {
		if (checkedOptions.includes("expandAll")) {
			// eslint-disable-next-line react/set-state-in-effect -- 展开/全选是 checkedOptions 的派生状态，需在 treeData 变化时同步重算，改为事件处理会丢失 treeData 联动
			setExpandedKeys(flattenTreeData.map(item => item.id));
		}
		else {
			// eslint-disable-next-line react/set-state-in-effect -- 同上：checkedOptions 派生状态的同步重置
			setExpandedKeys([]);
		}
		if (checkedOptions.includes("checkAll")) {
			onChange?.(flattenTreeData.map(item => item.id));
		}
		else {
			onChange?.([]);
		}
		// eslint-disable-next-line react/exhaustive-deps -- onChange 为父组件受控回调（通常非 memo），补全会引发重复回写
	}, [checkedOptions, flattenTreeData]);
	return (
		<>
			<Search
				className="mb-3"
				placeholder={t("common.keywordSearch")}
				allowClear
				value={searchValue}
				onChange={handleSearchChange}
			/>
			<Checkbox.Group
				options={[
					{ label: checkedOptions.includes("expandAll") ? t("common.collapseAll") : t("common.expandAll"), value: "expandAll" },
					{ label: checkedOptions.includes("checkAll") ? t("common.cancelAll") : t("common.checkAll"), value: "checkAll" },
				]}
				value={checkedOptions}
				rootClassName="flex justify-between items-center mb-3"
				onChange={onCheckboxChange}
			/>

			<Tree
				checkable
				blockNode
				defaultExpandAll
				// checkStrictly
				titleRender={node => t(node.title as string)}
				onExpand={onExpand}
				expandedKeys={expandedKeys}
				autoExpandParent={autoExpandParent}
				fieldNames={{
					key: "id",
				}}
				checkedKeys={value}
				// onSelect={onSelect}
				treeData={treeData as any}
				onCheck={onCheck}
			/>
		</>
	);
}
