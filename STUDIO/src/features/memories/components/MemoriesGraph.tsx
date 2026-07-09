import { useRef, useMemo, useEffect, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
// @ts-expect-error - Keeping THREE imported for future use as requested
import * as THREE from "three";
import { formatLabel } from "@/lib/formatters";
import type { Memory } from "../types";

interface MemoriesGraphProps {
  memories: Memory[];
  onNodeClick?: (node: any) => void;
}

/**
 * 3D force-directed memory/tag graph.
 *
 * The WebGL canvas (react-force-graph-3d / THREE) requires literal colour
 * strings for node/link/background fills — CSS variables can't reach into the
 * canvas. Per the strict-neutral carve-out (D-401, same as recharts), these use
 * neutral grey hexes only (no hue) and switch on the live `isDark` flag. All
 * surrounding DOM (container, overlay, legend) is fully tokenised.
 */
export const MemoriesGraph = ({ memories, onNodeClick }: MemoriesGraphProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isDark, setIsDark] = useState(false);

  // Resize observer for responsive canvas
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setDimensions({
          width: entries[0].contentRect.width,
          height: entries[0].contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Theme observer — drives the WebGL canvas colour strings (D-401 carve-out)
  useEffect(() => {
    const checkDark = () => document.documentElement.classList.contains("dark");
    setIsDark(checkDark());
    const observer = new MutationObserver(() => setIsDark(checkDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const graphData = useMemo(() => {
    const nodes: any[] = [];
    const links: any[] = [];
    const tagNodes = new Set<string>();

    memories.forEach((memory, index) => {
      const memoryId = `mem_${index}_${memory.key || "fallback"}`;
      nodes.push({
        id: memoryId,
        group: "memory",
        val: 1.5,
        name: formatLabel(memory.key || `Memory ${index + 1}`),
        content: memory.content,
        // eslint-disable-next-line no-restricted-syntax -- ForceGraph3D data-viz node colour; lib needs literal hex, not a CSS token
        color: isDark ? "#E5E7EB" : "#18181B",
        originalMemory: memory,
      });

      (memory.tags || []).forEach((tag) => {
        const tagId = `tag_${tag}`;
        if (!tagNodes.has(tagId)) {
          tagNodes.add(tagId);
          nodes.push({
            id: tagId,
            group: "tag",
            val: 1,
            name: formatLabel(tag),
            // eslint-disable-next-line no-restricted-syntax -- ForceGraph3D data-viz node colour; lib needs literal hex, not a CSS token
            color: isDark ? "#52525B" : "#A1A1AA",
          });
        }
        links.push({
          source: memoryId,
          target: tagId,
        });
      });
    });

    return { nodes, links };
  }, [memories, isDark]);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden rounded-xl bg-surface-base border border-surface-border transition-colors duration-normal">
      {/* ForceGraph3D data-viz colours — WebGL renderer needs literal hex strings, not CSS tokens */}
      {/* eslint-disable no-restricted-syntax */}
      <ForceGraph3D
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        backgroundColor={isDark ? "#181818" : "#f9fafb"}
        nodeColor={(node: any) => node.color}
        nodeLabel={(node: any) => node.name}
        nodeRelSize={6}
        linkColor={() => isDark ? "#404040" : "#e5e7eb"}
        linkOpacity={0.6}
        linkWidth={1}
        onNodeClick={onNodeClick}
        showNavInfo={false}
      />
      {/* eslint-enable no-restricted-syntax */}
      {/* Overlay to indicate interactivity */}
      <div className="absolute top-4 right-4 pointer-events-none">
        <span className="px-3 py-1 text-xs rounded-full bg-surface-raised/80 text-secondary backdrop-blur-md border border-surface-border">
          3D Interactive View — Drag to rotate, scroll to zoom
        </span>
      </div>
      <div className="absolute bottom-4 left-4 pointer-events-none flex flex-col gap-2">
        <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-primary shadow-sm border border-white/10"></span>
            <span className="text-xs text-secondary font-medium tracking-wide uppercase">Memory</span>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-muted shadow-sm border border-white/10"></span>
            <span className="text-xs text-secondary font-medium tracking-wide uppercase">Tag</span>
        </div>
      </div>
    </div>
  );
};
