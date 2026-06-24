"use client";

import { useState } from "react";

interface RenameChipProps {
  label: string;
  onStartEdit: () => void;
  title?: string;
  prefix?: string;
  style?: React.CSSProperties;
  className?: string;
}

export default function RenameChip({
  label,
  onStartEdit,
  title = "Click to rename",
  prefix,
  style,
  className,
}: RenameChipProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <span
      role="button"
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        onStartEdit();
      }}
      className={className}
      style={{
        fontSize: "0.62rem",
        color: "#92400E",
        background: "#FEF3C7",
        borderRadius: 4,
        padding: "1px 5px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
        cursor: "text",
        outline: hovered ? "2px solid #F59E0B" : "2px solid transparent",
        outlineOffset: 1,
        transition: "outline-color 0.15s ease",
        ...style,
      }}
    >
      {prefix}{label}
    </span>
  );
}
