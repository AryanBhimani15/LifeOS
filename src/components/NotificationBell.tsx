"use client";

import Link from "next/link";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  href: string;
  readAt: string | null;
  createdAt: string;
}

function timeAgo(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const panel = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { unread: number; items: NotificationItem[] };
      setItems(data.items);
      setUnread(data.unread);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open, refresh]);

  const update = async (body: { action: "read"; id: string } | { action: "read-all" }) => {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    const result = await response.json() as { unread: number };
    setUnread(result.unread);
    if (body.action === "read-all") setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    else setItems((current) => current.map((item) => item.id === body.id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item));
  };

  return <div className="notification-menu" ref={panel}>
    <button type="button" className="topbar-icon" aria-label="Notifications" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Bell size={18} strokeWidth={1.9} />
      {unread > 0 && <span className="topbar-notification-dot" />}
    </button>
    {open && <section className="notification-popover" aria-label="Notifications">
      <header><div><h2>Notifications</h2><p>{unread ? `${unread} unread` : "You’re up to date"}</p></div><button type="button" onClick={() => void update({ action: "read-all" })} disabled={unread === 0} title="Mark all as read"><CheckCheck size={15} /> Mark all read</button></header>
      <div className="notification-list">
        {loading ? <p className="notification-empty"><Loader2 size={15} className="spin" /> Loading notifications</p> : items.length === 0 ? <p className="notification-empty">No reminders have arrived yet.</p> : items.map((item) => <Link key={item.id} href={item.href} className={`notification-row${item.readAt ? "" : " is-unread"}`} onClick={() => { void update({ action: "read", id: item.id }); setOpen(false); }}><span className="notification-row-dot" /><span><b>{item.title}</b><em>{item.body}</em><small>{timeAgo(item.createdAt)}</small></span></Link>)}
      </div>
    </section>}
  </div>;
}
