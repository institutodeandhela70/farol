import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Instagram (menu Marketing) — lê as tabelas meta_ig_* (migration 20261026000000), preenchidas
// pelo sync-meta-instagram. Dias das métricas da conta seguem o fuso do Instagram (Pacífico).

type Num = number | string | null;
const n = (v: Num | undefined) => (v === null || v === undefined ? 0 : Number(v));

export interface IgAccount {
  ig_user_id: string;
  username: string | null;
  name: string | null;
  followers_count: number | null;
  profile_picture_url: string | null;
}

export function useIgAccounts(ws: string | undefined) {
  return useQuery({
    queryKey: ["ig", "accounts", ws],
    enabled: !!ws,
    queryFn: async (): Promise<IgAccount[]> => {
      const { data, error } = await supabase
        .from("meta_ig_accounts")
        .select("ig_user_id, username, name, followers_count, profile_picture_url")
        .eq("workspace_id", ws!)
        .eq("enabled", true);
      if (error) throw error;
      return (data ?? []) as IgAccount[];
    },
  });
}

export interface IgFreshness {
  running: boolean;
  mediaListed: number;
  mediaWithInsights: number;
  accountDaysThrough: string | null;
  lastError: string | null;
}

export function useIgFreshness(ws: string | undefined) {
  return useQuery({
    queryKey: ["ig", "freshness", ws],
    enabled: !!ws,
    refetchInterval: 30_000,
    queryFn: async (): Promise<IgFreshness> => {
      const [{ data: state }, listed, withIns] = await Promise.all([
        supabase.from("meta_sync_state").select("dataset, cursor_date, cycle_started_at, loaded_through, last_error").eq("workspace_id", ws!).like("dataset", "ig\\_%"),
        supabase.from("meta_ig_media").select("*", { count: "exact", head: true }).eq("workspace_id", ws!).neq("product_type", "STORY"),
        supabase.from("meta_ig_media").select("*", { count: "exact", head: true }).eq("workspace_id", ws!).neq("product_type", "STORY").not("insights_synced_at", "is", null),
      ]);
      const rows = state ?? [];
      // stories é um ciclo curto e recorrente — não conta como "carga em andamento"
      const heavy = rows.filter((r) => r.dataset !== "ig_stories");
      return {
        running: heavy.some((r) => r.cursor_date || r.cycle_started_at),
        mediaListed: listed.count ?? 0,
        mediaWithInsights: withIns.count ?? 0,
        accountDaysThrough: (rows.find((r) => r.dataset === "ig_account_insights")?.loaded_through as string | undefined) ?? null,
        lastError: (rows.find((r) => r.last_error)?.last_error as string | undefined) ?? null,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Série diária da conta
// ---------------------------------------------------------------------------

export interface IgDay {
  date: string;
  reach: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  total_interactions: number;
  accounts_engaged: number;
  follows_net: number;
}

export function useIgDaily(ws: string | undefined, ig: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["ig", "daily", ws, ig, from, to],
    enabled: !!ws && !!ig,
    queryFn: async (): Promise<IgDay[]> => {
      const { data, error } = await supabase
        .from("meta_ig_account_daily")
        .select("date, reach, views, likes, comments, shares, saves, total_interactions, accounts_engaged, follows_net")
        .eq("workspace_id", ws!)
        .eq("ig_user_id", ig!)
        .gte("date", from)
        .lte("date", to)
        .order("date");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        date: r.date as string,
        reach: n(r.reach),
        views: n(r.views),
        likes: n(r.likes),
        comments: n(r.comments),
        shares: n(r.shares),
        saves: n(r.saves),
        total_interactions: n(r.total_interactions),
        accounts_engaged: n(r.accounts_engaged),
        follows_net: n(r.follows_net),
      }));
    },
  });
}

/** Saldo de seguidores depois de `from` — usado pra reconstruir a curva de seguidores a partir do número de hoje. */
export function useIgFollowersNet(ws: string | undefined, ig: string | undefined, from: string) {
  return useQuery({
    queryKey: ["ig", "net-after", ws, ig, from],
    enabled: !!ws && !!ig,
    queryFn: async (): Promise<{ date: string; net: number }[]> => {
      const { data, error } = await supabase
        .from("meta_ig_account_daily")
        .select("date, follows_net")
        .eq("workspace_id", ws!)
        .eq("ig_user_id", ig!)
        .gte("date", from)
        .order("date");
      if (error) throw error;
      return (data ?? []).map((r) => ({ date: r.date as string, net: n(r.follows_net) }));
    },
  });
}

// ---------------------------------------------------------------------------
// Conteúdo (posts, reels, stories)
// ---------------------------------------------------------------------------

export type IgContentType = "FEED" | "REELS" | "STORY";

export interface IgMedia {
  media_id: string;
  product_type: string | null;
  media_type: string | null;
  caption: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  posted_at: string | null;
  like_count: number;
  comments_count: number;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saved: number | null;
  total_interactions: number | null;
  reposts: number | null;
  follows: number | null;
  profile_visits: number | null;
  replies: number | null;
  avg_watch_time_ms: number | null;
  story_navigation: Record<string, number> | null;
  insights_synced_at: string | null;
  insights_error: string | null;
  expired_at: string | null;
}

const MEDIA_COLS =
  "media_id, product_type, media_type, caption, permalink, thumbnail_url, media_url, posted_at, like_count, comments_count, reach, views, likes, comments, shares, saved, total_interactions, reposts, follows, profile_visits, replies, avg_watch_time_ms, story_navigation, insights_synced_at, insights_error, expired_at";

const orNull = (v: Num | undefined) => (v === null || v === undefined ? null : Number(v));

export function useIgMedia(
  ws: string | undefined,
  ig: string | undefined,
  type: IgContentType | "ALL",
  fromDay: string,
  toDay: string,
  sort: string,
  limit = 300,
) {
  return useQuery({
    queryKey: ["ig", "media", ws, ig, type, fromDay, toDay, sort, limit],
    enabled: !!ws && !!ig,
    queryFn: async (): Promise<IgMedia[]> => {
      let q = supabase
        .from("meta_ig_media")
        .select(MEDIA_COLS)
        .eq("workspace_id", ws!)
        .eq("ig_user_id", ig!)
        .gte("posted_at", `${fromDay}T00:00:00-03:00`)
        .lte("posted_at", `${toDay}T23:59:59-03:00`);
      if (type !== "ALL") q = q.eq("product_type", type);
      const { data, error } = await q.order(sort, { ascending: false, nullsFirst: false }).limit(limit);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...(r as unknown as IgMedia),
        like_count: n(r.like_count as Num),
        comments_count: n(r.comments_count as Num),
        reach: orNull(r.reach as Num),
        views: orNull(r.views as Num),
        likes: orNull(r.likes as Num),
        comments: orNull(r.comments as Num),
        shares: orNull(r.shares as Num),
        saved: orNull(r.saved as Num),
        total_interactions: orNull(r.total_interactions as Num),
        reposts: orNull(r.reposts as Num),
        follows: orNull(r.follows as Num),
        profile_visits: orNull(r.profile_visits as Num),
        replies: orNull(r.replies as Num),
        avg_watch_time_ms: orNull(r.avg_watch_time_ms as Num),
      }));
    },
  });
}

/** Contagem de publicações por tipo no período. */
export function useIgPublishCounts(ws: string | undefined, ig: string | undefined, fromDay: string, toDay: string) {
  return useQuery({
    queryKey: ["ig", "publish-counts", ws, ig, fromDay, toDay],
    enabled: !!ws && !!ig,
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from("meta_ig_media")
        .select("product_type")
        .eq("workspace_id", ws!)
        .eq("ig_user_id", ig!)
        .gte("posted_at", `${fromDay}T00:00:00-03:00`)
        .lte("posted_at", `${toDay}T23:59:59-03:00`)
        .limit(5000);
      if (error) throw error;
      const out: Record<string, number> = {};
      for (const r of data ?? []) out[(r.product_type as string) ?? "?"] = (out[(r.product_type as string) ?? "?"] ?? 0) + 1;
      return out;
    },
  });
}

// ---------------------------------------------------------------------------
// Audiência e comentários
// ---------------------------------------------------------------------------

export interface AudienceRow {
  metric: "follower" | "engaged";
  breakdown: "age" | "gender" | "city" | "country";
  key: string;
  value: number;
}

export function useIgAudience(ws: string | undefined, ig: string | undefined) {
  return useQuery({
    queryKey: ["ig", "audience", ws, ig],
    enabled: !!ws && !!ig,
    queryFn: async (): Promise<{ date: string | null; rows: AudienceRow[] }> => {
      const { data: latest } = await supabase
        .from("meta_ig_audience")
        .select("date")
        .eq("workspace_id", ws!)
        .eq("ig_user_id", ig!)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latest?.date) return { date: null, rows: [] };
      const { data, error } = await supabase
        .from("meta_ig_audience")
        .select("metric, breakdown, key, value")
        .eq("workspace_id", ws!)
        .eq("ig_user_id", ig!)
        .eq("date", latest.date)
        .limit(5000);
      if (error) throw error;
      return { date: latest.date as string, rows: (data ?? []).map((r) => ({ metric: r.metric as AudienceRow["metric"], breakdown: r.breakdown as AudienceRow["breakdown"], key: r.key as string, value: n(r.value as Num) })) };
    },
  });
}

export interface IgComment {
  comment_id: string;
  media_id: string;
  parent_id: string | null;
  text: string | null;
  commented_at: string | null;
  like_count: number;
  permalink: string | null;
}

export function useIgComments(ws: string | undefined, ig: string | undefined, search: string, onlyTop: boolean) {
  return useQuery({
    queryKey: ["ig", "comments", ws, ig, search, onlyTop],
    enabled: !!ws && !!ig,
    queryFn: async (): Promise<{ rows: IgComment[]; total: number }> => {
      let q = supabase
        .from("meta_ig_comments")
        .select("comment_id, media_id, parent_id, text, commented_at, like_count", { count: "exact" })
        .eq("workspace_id", ws!)
        .eq("ig_user_id", ig!);
      if (onlyTop) q = q.is("parent_id", null);
      if (search.trim()) q = q.ilike("text", `%${search.trim().replaceAll("%", "")}%`);
      const { data, error, count } = await q.order("commented_at", { ascending: false }).limit(100);
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((c) => c.media_id as string))];
      const links = new Map<string, string | null>();
      if (ids.length) {
        const { data: media } = await supabase.from("meta_ig_media").select("media_id, permalink").eq("workspace_id", ws!).in("media_id", ids);
        for (const m of media ?? []) links.set(m.media_id as string, m.permalink as string | null);
      }
      return {
        total: count ?? 0,
        rows: (data ?? []).map((c) => ({
          comment_id: c.comment_id as string,
          media_id: c.media_id as string,
          parent_id: c.parent_id as string | null,
          text: c.text as string | null,
          commented_at: c.commented_at as string | null,
          like_count: n(c.like_count as Num),
          permalink: links.get(c.media_id as string) ?? null,
        })),
      };
    },
  });
}

export const TYPE_LABEL: Record<string, string> = { FEED: "Post", REELS: "Reel", STORY: "Story" };
export const MEDIA_TYPE_LABEL: Record<string, string> = { IMAGE: "Imagem", VIDEO: "Vídeo", CAROUSEL_ALBUM: "Carrossel" };
export const GENDER_LABEL: Record<string, string> = { F: "Feminino", M: "Masculino", U: "Não informado" };
