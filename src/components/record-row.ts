import type { HTMLAttributes } from "react";
import { useNavigate } from "react-router";
import {
  recordTitle,
  resourceMap,
  type RecordData,
} from "../../shared/resources";
import { useAdmin } from "../context";

const interactiveSelector = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="combobox"]',
  '[contenteditable="true"]',
  "[data-no-row-navigation]",
].join(",");

function hasSelectedText(row: HTMLElement): boolean {
  const selection = row.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index += 1)
    if (selection.getRangeAt(index).intersectsNode(row)) return true;
  return false;
}

export function navigationRow<T extends HTMLElement>(
  open: () => void,
  label: string,
): HTMLAttributes<T> {
  return {
    className: "clickable-record-row",
    tabIndex: 0,
    "aria-label": label,
    onClick: (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target =
        event.target instanceof Element
          ? event.target
          : event.target instanceof Node
            ? event.target.parentElement
            : null;
      const rowElement = event.currentTarget;
      // React portals can bubble events through a row from outside its DOM.
      if (!target || !rowElement.contains(target)) return;
      const interactive = target.closest(interactiveSelector);
      if (interactive && rowElement.contains(interactive)) return;
      if (hasSelectedText(rowElement)) return;
      open();
    },
    onKeyDown: (event) => {
      if (
        event.defaultPrevented ||
        event.target !== event.currentTarget ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        (event.key !== "Enter" && event.key !== " ")
      )
        return;
      event.preventDefault();
      open();
    },
  };
}

export function useRecordRow(
  resource: string,
): (row: RecordData) => HTMLAttributes<HTMLTableRowElement> {
  const navigate = useNavigate();
  const { can } = useAdmin();
  return (row) => {
    const definition = resourceMap[resource];
    const id = row.id;
    if (
      !definition ||
      !can(definition, "show") ||
      typeof id !== "string" ||
      !/^[1-9]\d{0,18}$/.test(id) ||
      BigInt(id) > 9223372036854775807n
    )
      return {};
    const title = recordTitle(row).trim();
    const open = () => navigate(`/${resource}/${id}`);
    return navigationRow(
      open,
      `Open ${definition.singular} ${title && title !== id ? title : `#${id}`}`,
    );
  };
}
