// app/layout.tsx
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <head>
        <script dangerouslySetInnerHTML={{
          __html: `
            console.log("=== LAYOUT SCRIPT EXECUTING ===");
            console.log("window.__TAURI__:", typeof window.__TAURI__);
            console.log("window.location:", window.location.href);
            
            // Try to log to Rust if available
            if (window.__TAURI__) {
              window.__TAURI__.core.invoke("log_frontend", { 
                message: "Layout script executed - Tauri API is available!" 
              }).catch(e => console.error("Failed to log to Rust:", e));
            } else {
              console.log("Tauri API not available in layout script");
            }
          `
        }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
