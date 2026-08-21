"use client";

import { Bell, CheckCircle2, MonitorOff } from "lucide-react";
import { useSyncExternalStore } from "react";

type BrowserPermission = "unsupported" | "default" | "granted" | "denied";

/** Status only: push cannot be enabled honestly until its full stack exists. */
export function NotificationStatus() {
  const permission = useSyncExternalStore<BrowserPermission>(
    () => () => {},
    () => ("Notification" in window ? Notification.permission : "unsupported"),
    () => "unsupported",
  );

  const browserText = permission === "unsupported"
    ? "Not supported by this browser"
    : permission === "denied"
      ? "Blocked in browser settings"
      : permission === "granted"
        ? "Permission granted — push delivery still needs to be configured"
        : "Not enabled";

  return <section className="goal-panel notification-settings">
    <header><h2>Notifications</h2></header>
    <div className="notification-status-row">
      <CheckCircle2 size={18} aria-hidden="true" />
      <span><b>In-app notifications</b><em>Enabled. Due reminders appear in the notification bell after the server scheduler processes them.</em></span>
    </div>
    <div className="notification-status-row is-muted">
      <MonitorOff size={18} aria-hidden="true" />
      <span><b>Browser notifications</b><em>{browserText}. LifeOS has not configured a service worker, Push API subscription, or server push credentials yet, so it cannot claim closed-browser alerts.</em></span>
    </div>
    <p className="settings-note"><Bell size={13} /> The bell keeps your unread in-app reminder history and opens the original task or event.</p>
  </section>;
}
