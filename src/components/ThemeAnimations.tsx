import React, { useEffect, useRef } from "react";
import { useTheme } from "../theme/ThemeProvider";

export function ThemeAnimations() {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let animationFrameId: number;
    let isActive = true;

    const resize = () => {
      if (!isActive) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", resize);

    if (theme === "christmas") {
      // Snowflakes
      const snowflakes: Array<{ x: number; y: number; size: number; speed: number; rotation: number; rotationSpeed: number }> = [];
      for (let i = 0; i < 60; i++) {
        snowflakes.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 3 + 1,
          speed: Math.random() * 2 + 1,
          rotation: Math.random() * 360,
          rotationSpeed: Math.random() * 2 - 1,
        });
      }


      const drawSnowflake = (x: number, y: number, size: number, rotation: number) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          ctx.moveTo(0, 0);
          ctx.lineTo(0, size);
          ctx.moveTo(0, 0);
          ctx.lineTo(size * 0.5, size * 0.5);
          ctx.rotate((60 * Math.PI) / 180);
        }
        ctx.stroke();
        ctx.restore();
      };


      const animate = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw snowflakes
        snowflakes.forEach((flake) => {
          flake.y += flake.speed;
          flake.rotation += flake.rotationSpeed;
          if (flake.y > canvas.height) {
            flake.y = -10;
            flake.x = Math.random() * canvas.width;
          }
          drawSnowflake(flake.x, flake.y, flake.size, flake.rotation);
        });
        
        if (isActive) {
          animationFrameId = requestAnimationFrame(animate);
        }
      };
      animate();

      return () => {
        isActive = false;
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
      };
    } else if (theme === "halloween") {
      // Bats
      const bats: Array<{ x: number; y: number; size: number; speedX: number; speedY: number; rotation: number; wingFlap: number }> = [];
      for (let i = 0; i < 10; i++) {
        bats.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 15 + 10,
          speedX: Math.random() * 2 - 1,
          speedY: Math.random() * 1 - 0.5,
          rotation: Math.random() * 360,
          wingFlap: Math.random() * Math.PI * 2,
        });
      }


      const drawBat = (x: number, y: number, size: number, rotation: number, wingFlap: number) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        // Bat body
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2);
        ctx.fill();
        // Bat wings with animation
        const wingAngle = Math.sin(wingFlap) * 0.3;
        ctx.beginPath();
        ctx.ellipse(-size * 0.4, 0, size * 0.5, size * 0.3, -0.3 - wingAngle, 0, Math.PI * 2);
        ctx.ellipse(size * 0.4, 0, size * 0.5, size * 0.3, 0.3 + wingAngle, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };


      const animate = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw bats
        bats.forEach((bat) => {
          bat.x += bat.speedX;
          bat.y += bat.speedY;
          bat.rotation += 0.5;
          bat.wingFlap += 0.3;
          if (bat.x < -30) bat.x = canvas.width + 30;
          if (bat.x > canvas.width + 30) bat.x = -30;
          if (bat.y < -30) bat.y = canvas.height + 30;
          if (bat.y > canvas.height + 30) bat.y = -30;
          drawBat(bat.x, bat.y, bat.size, bat.rotation, bat.wingFlap);
        });
        
        if (isActive) {
          animationFrameId = requestAnimationFrame(animate);
        }
      };
      animate();

      return () => {
        isActive = false;
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
      };
    }

    return () => {
      isActive = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener("resize", resize);
    };
  }, [theme]);

  if (theme !== "christmas" && theme !== "halloween") return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}

