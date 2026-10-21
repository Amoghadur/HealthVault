import { useState, useEffect } from "react";
import Navbar from "../components/common/Navbar";
import SpatialBackground from "../components/common/SpatialBackground";
import PillButton from "../components/common/PillButton";
import { LEGAL_CONFIG } from "./legalConfig";
import "./Legal.css";

export default function LegalPageLayout({
  title,
  subtitle,
  sections = [],
  onBack,
  onNavigate,
}) {
  const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id || "");

  // Update document title for accessibility and browser tabs
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} — ${LEGAL_CONFIG.PROJECT_NAME}`;
    return () => {
      document.title = previousTitle;
    };
  }, [title]);

  // Scroll spy with IntersectionObserver to highlight active TOC item
  useEffect(() => {
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries.filter((e) => e.isIntersecting);
        if (visibleEntries.length > 0) {
          // Select the topmost visible section
          const sorted = visibleEntries.sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
          );
          setActiveSectionId(sorted[0].target.id);
        }
      },
      {
        rootMargin: "-90px 0px -55% 0px",
        threshold: [0, 0.25, 0.5, 1],
      }
    );

    sections.forEach((sec) => {
      const el = document.getElementById(sec.id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [sections]);

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveSectionId(id);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="legal-page-wrapper">
      <SpatialBackground />

      {/* Floating Top Navbar with Navigation & Menu */}
      <Navbar
        onNavigate={(target) => {
          if (target === "home") onBack ? onBack() : onNavigate?.("home");
          else if (target === "privacy") onNavigate?.("privacy");
          else if (target === "terms") onNavigate?.("terms");
          else if (target === "story" || target === "how" || target === "features") {
            onNavigate?.("home");
            setTimeout(() => {
              const el = document.getElementById(`${target}-section`) || document.getElementById("mission-section");
              el?.scrollIntoView({ behavior: "smooth" });
            }, 100);
          }
        }}
        onOpenAuth={(role) => {
          onNavigate?.("auth", role);
        }}
      />

      <main className="legal-main-container">
        {/* Student Project Demonstration Notice Banner */}
        <div className="legal-demo-banner" role="note" aria-label="Student Demonstration Notice">
          <div className="legal-demo-icon">ℹ</div>
          <div className="legal-demo-text">
            <strong>Demonstration Notice:</strong> This document describes a student project ({LEGAL_CONFIG.PROJECT_NAME}) and is provided for academic demonstration. It is not legal advice or a certified commercial healthcare guarantee.
          </div>
        </div>

        {/* Floating VisionOS Glass Content Panel */}
        <div className="glass-card spatial-layer-1 legal-panel">
          {/* Header area */}
          <header className="legal-header">
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <button
                type="button"
                onClick={onBack}
                className="legal-back-btn"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--primary-dark)",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "4px 0",
                }}
              >
                ← Back to home
              </button>
            </div>

            <h1
              className="two-tone-heading"
              style={{
                fontSize: "clamp(28px, 4vw, 40px)",
                margin: "0 0 10px 0",
              }}
            >
              {title}
            </h1>

            {subtitle && (
              <p
                style={{
                  fontSize: "14px",
                  color: "var(--text-secondary)",
                  margin: "0 0 16px 0",
                  lineHeight: 1.5,
                }}
              >
                {subtitle}
              </p>
            )}

            <div className="legal-meta-bar">
              <div className="legal-timestamp">
                <span>🗓</span>
                <span>
                  Last updated: <strong>{LEGAL_CONFIG.LAST_UPDATED}</strong>
                </span>
              </div>

              <div className="legal-actions">
                <PillButton
                  size="sm"
                  variant="outline"
                  onClick={handlePrint}
                  className="legal-print-btn"
                  icon={<span>🖨</span>}
                >
                  Print / Save as PDF
                </PillButton>
              </div>
            </div>
          </header>

          {/* Mobile Sticky Table of Contents Dropdown */}
          <div className="legal-mobile-toc" aria-label="Table of Contents Navigation">
            <label
              htmlFor="legal-mobile-toc-select"
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-tertiary)",
                display: "block",
                marginBottom: "6px",
              }}
            >
              Jump to Section
            </label>
            <select
              id="legal-mobile-toc-select"
              className="legal-mobile-select"
              value={activeSectionId}
              onChange={(e) => scrollToSection(e.target.value)}
            >
              {sections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.number}. {sec.title}
                </option>
              ))}
            </select>
          </div>

          {/* Main 2-Column Grid Layout */}
          <div className="legal-grid">
            {/* Left: Sticky Table of Contents (Desktop) */}
            <aside className="legal-toc-wrapper" aria-label="Table of Contents">
              <span className="legal-toc-title">Table of Contents</span>
              <ul className="legal-toc-list">
                {sections.map((sec) => {
                  const isActive = activeSectionId === sec.id;
                  return (
                    <li
                      key={sec.id}
                      className={`legal-toc-item ${isActive ? "active" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => scrollToSection(sec.id)}
                        aria-current={isActive ? "true" : undefined}
                      >
                        <span className="legal-toc-num">{sec.number}.</span>
                        <span>{sec.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid var(--border-subtle)" }}>
                <button
                  type="button"
                  onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--primary-dark)",
                    cursor: "pointer",
                    padding: "4px 8px",
                  }}
                >
                  ↑ Return to top
                </button>
              </div>
            </aside>

            {/* Right: Numbered Document Sections */}
            <article className="legal-content-column">
              {sections.map((sec) => (
                <section key={sec.id} id={sec.id} className="legal-section">
                  <div className="legal-section-header">
                    <span className="legal-section-badge">§ {sec.number}</span>
                    <h2 className="legal-section-title">{sec.title}</h2>
                  </div>
                  <div className="legal-prose">{sec.content}</div>
                </section>
              ))}

              {/* Bottom return link */}
              <div
                style={{
                  marginTop: "40px",
                  paddingTop: "24px",
                  borderTop: "1px solid var(--border-subtle)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "14px",
                }}
              >
                <PillButton size="md" variant="primary" onClick={onBack}>
                  ← Back to Home
                </PillButton>
                <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                  {LEGAL_CONFIG.PROJECT_NAME}
                </span>
              </div>
            </article>
          </div>
        </div>
      </main>
    </div>
  );
}
