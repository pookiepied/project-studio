import { ShaderGradient, ShaderGradientCanvas } from "@shadergradient/react";

export function ProjectShaderCover({ accent = "#7288ff" }: { accent?: string | null }) {
  return (
    <ShaderGradientCanvas
      className="workspace-project-shader"
      style={{ position: "absolute", inset: 0 }}
      pixelDensity={1}
      fov={42}
      pointerEvents="none"
      lazyLoad
      powerPreference="low-power"
    >
      <ShaderGradient
        control="props"
        type="waterPlane"
        animate="on"
        color1="#f7faff"
        color2={accent || "#7288ff"}
        color3="#9ee7ff"
        brightness={1.16}
        lightType="3d"
        grain="on"
        grainBlending={0.14}
        uSpeed={0.12}
        uStrength={2.4}
        uDensity={1.25}
        uFrequency={3.7}
        uAmplitude={0.7}
        cAzimuthAngle={160}
        cPolarAngle={88}
        cDistance={3.6}
        cameraZoom={1}
        rotationX={0}
        rotationY={0}
        rotationZ={18}
        reflection={0.18}
        enableTransition
      />
    </ShaderGradientCanvas>
  );
}
