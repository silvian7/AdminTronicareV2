import { FileTextOutlined } from "@ant-design/icons";
import { Tag, Tooltip } from "antd";

export function TemplateIndicator({
  resource,
  value,
}: {
  resource: "rules" | "actions";
  value: unknown;
}) {
  if (value !== true) return null;
  const label = resource === "rules" ? "Rule template" : "Action template";
  return (
    <Tooltip title={label}>
      <Tag
        className="template-indicator"
        color="purple"
        icon={<FileTextOutlined aria-hidden />}
        role="img"
        aria-label={label}
      >
        Template
      </Tag>
    </Tooltip>
  );
}
