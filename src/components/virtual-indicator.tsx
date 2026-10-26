import type { ReactNode } from "react";
import { ApiOutlined } from "@ant-design/icons";
import { Tag, Tooltip } from "antd";
import { isVirtualTag } from "../../shared/virtual";

export function VirtualIndicator({
  value,
  focusable = true,
}: {
  value: unknown;
  focusable?: boolean;
}) {
  if (!isVirtualTag(value)) return null;
  return (
    <Tooltip title="Virtual element" trigger={["hover", "focus"]}>
      <Tag
        className="virtual-indicator"
        color="geekblue"
        icon={<ApiOutlined aria-hidden />}
        role="img"
        aria-label="Virtual element"
        tabIndex={focusable ? 0 : undefined}
        data-no-row-navigation
      >
        Virtual
      </Tag>
    </Tooltip>
  );
}

export function VirtualRecordLabel({
  label,
  tag,
}: {
  label: ReactNode;
  tag: unknown;
}) {
  return (
    <span className="record-option-label">
      <span className="record-option-text">{label}</span>
      <VirtualIndicator value={tag} focusable={false} />
    </span>
  );
}
