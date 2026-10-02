import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, expand, reduce, EMPTY } from 'rxjs';
import { map } from 'rxjs/operators';

// ─── Raw API Types ─────────────────────────────────────────────────────────────

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string;
}

export interface SleeperLeague {
  league_id: string;
  previous_league_id: string | null;
  draft_id: string;
  name: string;
  season: string;
  sport: string;
  status: string;
  total_rosters: number;
  avatar: string | null;
  settings: Record<string, unknown>;
  scoring_settings: Record<string, unknown>;
  roster_positions: string[];
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  league_id: string;
  players: string[];
  starters: string[];
  reserve: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal: number;
    fpts_against: number;
    fpts_against_decimal: number;
    total_moves: number;
    waiver_budget_used: number;
    waiver_position: number;
  };
}

export interface SleeperLeagueUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string;
  metadata: Record<string, unknown>;
  is_owner: boolean;
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id: number;
  points: number | null;
  starters: string[];
  players: string[];
  players_points: Record<string, number>;
  starters_points: number[];
}

export interface SleeperBracketMatch {
  r: number;   // round
  m: number;   // match id
  t1: number;  // roster_id team 1
  t2: number;  // roster_id team 2
  w: number;   // winner roster_id
  l: number;   // loser roster_id
}

export interface SleeperTransaction {
  transaction_id: string;
  type: 'trade' | 'free_agent' | 'waiver';
  status: string;
  roster_ids: number[];
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: SleeperTradedPick[];
  creator: string;
  created: number;
  settings: Record<string, unknown> | null;
  leg: number;
}

export interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

export interface SleeperNflState {
  week: number;
  season_type: string;
  season_start_date: string;
  season: string;
  previous_season: string;
  leg: number;
  league_create_season: string;
  display_week: number;
}

export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  type: string;
  status: string;
  sport: string;
  season: string;
  season_type: string;
  settings: Record<string, unknown>;
  draft_order: Record<string, number> | null;
  slot_to_roster_id: Record<string, number>;
  start_time: number;
  last_picked: number;
}

export interface SleeperDraftPick {
  pick_no: number;
  round: number;
  draft_slot: number;
  roster_id: number;
  player_id: string;
  picked_by: string;
  metadata: Record<string, unknown>;
}

export interface SleeperPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  team: string;
  position: string;
  fantasy_positions: string[];
  age: number;
  years_exp: number;
  status: string;
  injury_status: string | null;
  number: number;
  depth_chart_order: number | null;
}

export interface SleeperTrendingPlayer {
  player_id: string;
  count: number;
}

// ─── Computed / Analytics Types ────────────────────────────────────────────────

/** Combined league + users + rosters in a single call */
export interface LeagueSnapshot {
  league: SleeperLeague;
  users: SleeperLeagueUser[];
  rosters: SleeperRoster[];
}

/** Full standings row with streak */
export interface TeamStanding {
  rosterId: number;
  ownerId: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** e.g. "W3" or "L1" */
  streak: string;
  winPct: number;
}

/**
 * Schedule-luck analysis:
 * expectedWins = sum across all weeks of (teams beaten / (n - 1))
 * luckDelta    = actualWins − expectedWins
 * Positive delta → you got lucky with your schedule; negative → unlucky.
 */
export interface ScheduleLuck {
  rosterId: number;
  actualWins: number;
  expectedWins: number;
  luckDelta: number;
}

/**
 * Power ranking row.
 * Ranked by season average; also tracks last-3-week trend.
 */
export interface PowerRanking {
  rosterId: number;
  avgPointsFor: number;
  last3WeeksAvg: number;
  rank: number;
}

/**
 * Consistency: lower std deviation relative to average = more consistent.
 * consistencyScore = 1 − (stdDev / avg)  [0..1, higher = more consistent]
 */
export interface ConsistencyRating {
  rosterId: number;
  avgPoints: number;
  stdDev: number;
  consistencyScore: number;
}

/**
 * Lineup efficiency: how close was the manager to the optimal possible lineup?
 * Optimal = top N scorers from the full roster that week.
 * efficiency = actualStarterPts / optimalStarterPts  [0..1]
 */
export interface LineupEfficiency {
  rosterId: number;
  weeklyEfficiency: number[];
  avgEfficiency: number;
  /** Total points left on the bench across the season */
  totalPointsLeft: number;
}

/** Per-team trade activity summary */
export interface TradeActivity {
  rosterId: number;
  tradesInvolved: number;
  playersAcquired: string[];
  playersGiven: string[];
  picksAcquired: SleeperTradedPick[];
  picksGiven: SleeperTradedPick[];
}

/** Waiver / free-agent add breakdown per team */
export interface WaiverActivity {
  rosterId: number;
  totalMoves: number;
  adds: string[];
  drops: string[];
}

// ─── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class SleeperService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'https://api.sleeper.app/v1';

  // ── User ────────────────────────────────────────────────────────────────────

  getUserByUsername(username: string): Observable<SleeperUser> {
    return this.http.get<SleeperUser>(`${this.baseUrl}/user/${username}`);
  }

  getUserById(userId: string): Observable<SleeperUser> {
    return this.http.get<SleeperUser>(`${this.baseUrl}/user/${userId}`);
  }

  // ── Leagues ─────────────────────────────────────────────────────────────────

  getLeaguesForUser(userId: string, sport: string, season: string): Observable<SleeperLeague[]> {
    return this.http.get<SleeperLeague[]>(`${this.baseUrl}/user/${userId}/leagues/${sport}/${season}`);
  }

  getLeague(leagueId: string): Observable<SleeperLeague> {
    return this.http.get<SleeperLeague>(`${this.baseUrl}/league/${leagueId}`);
  }

  getRosters(leagueId: string): Observable<SleeperRoster[]> {
    return this.http.get<SleeperRoster[]>(`${this.baseUrl}/league/${leagueId}/rosters`);
  }

  getUsersInLeague(leagueId: string): Observable<SleeperLeagueUser[]> {
    return this.http.get<SleeperLeagueUser[]>(`${this.baseUrl}/league/${leagueId}/users`);
  }

  getMatchups(leagueId: string, week: number): Observable<SleeperMatchup[]> {
    return this.http.get<SleeperMatchup[]>(`${this.baseUrl}/league/${leagueId}/matchups/${week}`);
  }

  getWinnersBracket(leagueId: string): Observable<SleeperBracketMatch[]> {
    return this.http.get<SleeperBracketMatch[]>(`${this.baseUrl}/league/${leagueId}/winners_bracket`);
  }

  getLosersBracket(leagueId: string): Observable<SleeperBracketMatch[]> {
    return this.http.get<SleeperBracketMatch[]>(`${this.baseUrl}/league/${leagueId}/losers_bracket`);
  }

  getTransactions(leagueId: string, round: number): Observable<SleeperTransaction[]> {
    return this.http.get<SleeperTransaction[]>(`${this.baseUrl}/league/${leagueId}/transactions/${round}`);
  }

  getTradedPicks(leagueId: string): Observable<SleeperTradedPick[]> {
    return this.http.get<SleeperTradedPick[]>(`${this.baseUrl}/league/${leagueId}/traded_picks`);
  }

  // ── NFL State ────────────────────────────────────────────────────────────────

  getNflState(sport: string = 'nfl'): Observable<SleeperNflState> {
    return this.http.get<SleeperNflState>(`${this.baseUrl}/state/${sport}`);
  }

  // ── Drafts ───────────────────────────────────────────────────────────────────

  getDraftsForUser(userId: string, sport: string, season: string): Observable<SleeperDraft[]> {
    return this.http.get<SleeperDraft[]>(`${this.baseUrl}/user/${userId}/drafts/${sport}/${season}`);
  }

  getDraftsForLeague(leagueId: string): Observable<SleeperDraft[]> {
    return this.http.get<SleeperDraft[]>(`${this.baseUrl}/league/${leagueId}/drafts`);
  }

  getDraft(draftId: string): Observable<SleeperDraft> {
    return this.http.get<SleeperDraft>(`${this.baseUrl}/draft/${draftId}`);
  }

  getDraftPicks(draftId: string): Observable<SleeperDraftPick[]> {
    return this.http.get<SleeperDraftPick[]>(`${this.baseUrl}/draft/${draftId}/picks`);
  }

  getDraftTradedPicks(draftId: string): Observable<SleeperTradedPick[]> {
    return this.http.get<SleeperTradedPick[]>(`${this.baseUrl}/draft/${draftId}/traded_picks`);
  }

  // ── Players ──────────────────────────────────────────────────────────────────

  getAllPlayers(sport: string = 'nfl'): Observable<Record<string, SleeperPlayer>> {
    return this.http.get<Record<string, SleeperPlayer>>(`${this.baseUrl}/players/${sport}`);
  }

  getTrendingPlayers(
    sport: string = 'nfl',
    type: 'add' | 'drop' = 'add',
    lookbackHours?: number,
    limit?: number
  ): Observable<SleeperTrendingPlayer[]> {
    let url = `${this.baseUrl}/players/${sport}/trending/${type}`;
    const params: string[] = [];
    if (lookbackHours !== undefined) params.push(`lookback_hours=${lookbackHours}`);
    if (limit !== undefined) params.push(`limit=${limit}`);
    if (params.length) url += `?${params.join('&')}`;
    return this.http.get<SleeperTrendingPlayer[]>(url);
  }

  // ── Combined Fetchers ────────────────────────────────────────────────────────

  /**
   * Fetch league, users, and rosters in a single parallel call.
   * Use this as the primary bootstrap for any page that needs all three.
   */
  getLeagueSnapshot(leagueId: string): Observable<LeagueSnapshot> {
    return forkJoin({
      league: this.getLeague(leagueId),
      users: this.getUsersInLeague(leagueId),
      rosters: this.getRosters(leagueId),
    });
  }

  /**
   * Walk the previous_league_id chain to collect all historical seasons.
   * Returns leagues newest-first.
   */
  getLeagueHistory(leagueId: string): Observable<SleeperLeague[]> {
    return this.getLeague(leagueId).pipe(
      expand(league =>
        league.previous_league_id ? this.getLeague(league.previous_league_id) : EMPTY
      ),
      reduce((acc, league) => [...acc, league], [] as SleeperLeague[])
    );
  }

  /**
   * Fetch all matchup weeks in parallel for the regular season.
   * Returns an array indexed by week (index 0 = week 1).
   */
  getFullSeasonMatchups(leagueId: string, regularSeasonWeeks: number): Observable<SleeperMatchup[][]> {
    const weeks = Array.from({ length: regularSeasonWeeks }, (_, i) => i + 1);
    return forkJoin(weeks.map(week => this.getMatchups(leagueId, week)));
  }

  /**
   * Fetch all transactions across the full season and flatten into one array.
   */
  getAllTransactions(leagueId: string, totalWeeks: number): Observable<SleeperTransaction[]> {
    const rounds = Array.from({ length: totalWeeks }, (_, i) => i + 1);
    return forkJoin(rounds.map(round => this.getTransactions(leagueId, round))).pipe(
      map(weekly => weekly.flat())
    );
  }

  /** All completed trades only */
  getAllTrades(leagueId: string, totalWeeks: number): Observable<SleeperTransaction[]> {
    return this.getAllTransactions(leagueId, totalWeeks).pipe(
      map(txns => txns.filter(t => t.type === 'trade' && t.status === 'complete'))
    );
  }

  /** All waiver and free-agent moves */
  getAllWaiverMoves(leagueId: string, totalWeeks: number): Observable<SleeperTransaction[]> {
    return this.getAllTransactions(leagueId, totalWeeks).pipe(
      map(txns => txns.filter(t => t.type === 'waiver' || t.type === 'free_agent'))
    );
  }

  // ── Analytics Engines ────────────────────────────────────────────────────────

  /**
   * Build standings from roster settings (which Sleeper keeps up to date).
   * Pass matchupsByWeek to also compute current win/loss streaks.
   */
  computeStandings(rosters: SleeperRoster[], matchupsByWeek: SleeperMatchup[][]): TeamStanding[] {
    const standings = new Map<number, TeamStanding>();

    for (const roster of rosters) {
      const s = roster.settings;
      standings.set(roster.roster_id, {
        rosterId: roster.roster_id,
        ownerId: roster.owner_id,
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        pointsFor: s.fpts + s.fpts_decimal / 100,
        pointsAgainst: s.fpts_against + s.fpts_against_decimal / 100,
        streak: '',
        winPct: (s.wins + s.ties * 0.5) / Math.max(s.wins + s.losses + s.ties, 1),
      });
    }

    // Calculate current streak by walking matchups chronologically
    const streakMap = new Map<number, { result: 'W' | 'L' | 'T'; count: number }>();

    for (const weekMatchups of matchupsByWeek) {
      const byMatchup = this.groupByMatchup(weekMatchups);
      for (const pair of byMatchup.values()) {
        if (pair.length !== 2) continue;
        const [a, b] = pair;
        const aResult = (a.points ?? 0) > (b.points ?? 0) ? 'W' : (a.points ?? 0) < (b.points ?? 0) ? 'L' : 'T';
        const bResult = aResult === 'W' ? 'L' : aResult === 'L' ? 'W' : 'T';
        this.updateStreak(streakMap, a.roster_id, aResult);
        this.updateStreak(streakMap, b.roster_id, bResult);
      }
    }

    for (const [rosterId, streak] of streakMap) {
      const s = standings.get(rosterId);
      if (s) s.streak = `${streak.result}${streak.count}`;
    }

    return Array.from(standings.values()).sort((a, b) =>
      b.wins !== a.wins ? b.wins - a.wins : b.pointsFor - a.pointsFor
    );
  }

  /**
   * Schedule-luck analysis.
   *
   * For each week, each team gets an "expected win" value equal to the fraction
   * of other teams they outscored.  Summed over the season this is their
   * expected win total under a random schedule.  luckDelta = actual − expected.
   */
  computeScheduleLuck(matchupsByWeek: SleeperMatchup[][]): ScheduleLuck[] {
    const actualWins = new Map<number, number>();
    const expectedWins = new Map<number, number>();
    const rosterIds = new Set<number>();

    for (const weekMatchups of matchupsByWeek) {
      const rosterPoints = new Map<number, number>();
      for (const m of weekMatchups) {
        rosterPoints.set(m.roster_id, m.points ?? 0);
        rosterIds.add(m.roster_id);
      }

      const allPoints = Array.from(rosterPoints.values());
      const n = allPoints.length;

      for (const [rosterId, pts] of rosterPoints) {
        const beaten = allPoints.filter(p => pts > p).length;
        const tied = allPoints.filter(p => pts === p).length - 1; // exclude self
        expectedWins.set(rosterId, (expectedWins.get(rosterId) ?? 0) + (beaten + tied * 0.5) / (n - 1));
      }

      const byMatchup = this.groupByMatchup(weekMatchups);
      for (const pair of byMatchup.values()) {
        if (pair.length !== 2) continue;
        const [a, b] = pair;
        if ((a.points ?? 0) > (b.points ?? 0)) {
          actualWins.set(a.roster_id, (actualWins.get(a.roster_id) ?? 0) + 1);
        } else if ((b.points ?? 0) > (a.points ?? 0)) {
          actualWins.set(b.roster_id, (actualWins.get(b.roster_id) ?? 0) + 1);
        } else {
          actualWins.set(a.roster_id, (actualWins.get(a.roster_id) ?? 0) + 0.5);
          actualWins.set(b.roster_id, (actualWins.get(b.roster_id) ?? 0) + 0.5);
        }
      }
    }

    return Array.from(rosterIds).map(rosterId => {
      const actual = actualWins.get(rosterId) ?? 0;
      const expected = round2(expectedWins.get(rosterId) ?? 0);
      return { rosterId, actualWins: actual, expectedWins: expected, luckDelta: round2(actual - expected) };
    }).sort((a, b) => b.luckDelta - a.luckDelta);
  }

  /**
   * Power rankings: sorted by season average points.
   * Also surfaces a last-3-week hot/cold indicator.
   */
  computePowerRankings(matchupsByWeek: SleeperMatchup[][]): PowerRanking[] {
    const rosterPoints = new Map<number, number[]>();

    for (const weekMatchups of matchupsByWeek) {
      for (const m of weekMatchups) {
        if (!rosterPoints.has(m.roster_id)) rosterPoints.set(m.roster_id, []);
        rosterPoints.get(m.roster_id)!.push(m.points ?? 0);
      }
    }

    const rankings = Array.from(rosterPoints.entries()).map(([rosterId, points]) => {
      const avg = points.reduce((a, b) => a + b, 0) / points.length;
      const last3 = points.slice(-3);
      const last3Avg = last3.reduce((a, b) => a + b, 0) / last3.length;
      return { rosterId, avgPointsFor: round2(avg), last3WeeksAvg: round2(last3Avg), rank: 0 };
    });

    rankings.sort((a, b) => b.avgPointsFor - a.avgPointsFor);
    rankings.forEach((r, i) => (r.rank = i + 1));
    return rankings;
  }

  /**
   * Consistency rating.
   * Low coefficient of variation = high consistency score (closer to 1.0).
   */
  computeConsistencyRatings(matchupsByWeek: SleeperMatchup[][]): ConsistencyRating[] {
    const rosterPoints = new Map<number, number[]>();

    for (const weekMatchups of matchupsByWeek) {
      for (const m of weekMatchups) {
        if (!rosterPoints.has(m.roster_id)) rosterPoints.set(m.roster_id, []);
        rosterPoints.get(m.roster_id)!.push(m.points ?? 0);
      }
    }

    return Array.from(rosterPoints.entries()).map(([rosterId, points]) => {
      const avg = points.reduce((a, b) => a + b, 0) / points.length;
      const variance = points.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / points.length;
      const stdDev = Math.sqrt(variance);
      const cv = avg > 0 ? stdDev / avg : 0;
      return {
        rosterId,
        avgPoints: round2(avg),
        stdDev: round2(stdDev),
        consistencyScore: round2(Math.max(0, 1 - cv)),
      };
    }).sort((a, b) => b.consistencyScore - a.consistencyScore);
  }

  /**
   * Lineup efficiency: how close was each manager to their optimal lineup?
   *
   * Optimal = the top `starterCount` point scorers from the full roster.
   * Requires `players_points` to be populated (it usually is for completed weeks).
   */
  computeLineupEfficiency(matchupsByWeek: SleeperMatchup[][], starterCount: number): LineupEfficiency[] {
    const rosterData = new Map<number, { weekly: number[]; totalLeft: number }>();

    for (const weekMatchups of matchupsByWeek) {
      for (const m of weekMatchups) {
        if (!m.players_points || !m.starters?.length) continue;

        const actualPts = m.starters.reduce((sum, pid) => sum + (m.players_points[pid] ?? 0), 0);
        const optimalPts = Object.values(m.players_points)
          .sort((a, b) => b - a)
          .slice(0, starterCount)
          .reduce((a, b) => a + b, 0);

        const efficiency = optimalPts > 0 ? Math.min(actualPts / optimalPts, 1) : 1;
        const leftOnBench = Math.max(optimalPts - actualPts, 0);

        if (!rosterData.has(m.roster_id)) rosterData.set(m.roster_id, { weekly: [], totalLeft: 0 });
        const d = rosterData.get(m.roster_id)!;
        d.weekly.push(round2(efficiency));
        d.totalLeft += leftOnBench;
      }
    }

    return Array.from(rosterData.entries()).map(([rosterId, d]) => ({
      rosterId,
      weeklyEfficiency: d.weekly,
      avgEfficiency: round2(d.weekly.reduce((a, b) => a + b, 0) / d.weekly.length),
      totalPointsLeft: round2(d.totalLeft),
    })).sort((a, b) => b.avgEfficiency - a.avgEfficiency);
  }

  /**
   * Trade activity summary per team.
   * Pass the flattened result of getAllTrades().
   */
  computeTradeActivity(trades: SleeperTransaction[]): TradeActivity[] {
    const activity = new Map<number, TradeActivity>();

    const getOrCreate = (rosterId: number): TradeActivity => {
      if (!activity.has(rosterId)) {
        activity.set(rosterId, {
          rosterId,
          tradesInvolved: 0,
          playersAcquired: [],
          playersGiven: [],
          picksAcquired: [],
          picksGiven: [],
        });
      }
      return activity.get(rosterId)!;
    };

    for (const trade of trades) {
      for (const rosterId of trade.roster_ids) {
        const a = getOrCreate(rosterId);
        a.tradesInvolved++;

        if (trade.adds) {
          for (const [playerId, addRosterId] of Object.entries(trade.adds)) {
            if (addRosterId === rosterId) a.playersAcquired.push(playerId);
            else if (trade.roster_ids.includes(addRosterId)) a.playersGiven.push(playerId);
          }
        }

        if (trade.draft_picks?.length) {
          for (const pick of trade.draft_picks) {
            if (pick.owner_id === rosterId) a.picksAcquired.push(pick);
            else if (pick.previous_owner_id === rosterId) a.picksGiven.push(pick);
          }
        }
      }
    }

    return Array.from(activity.values()).sort((a, b) => b.tradesInvolved - a.tradesInvolved);
  }

  /**
   * Waiver/free-agent activity summary per team.
   * Pass the flattened result of getAllWaiverMoves().
   */
  computeWaiverActivity(moves: SleeperTransaction[]): WaiverActivity[] {
    const activity = new Map<number, WaiverActivity>();

    for (const move of moves) {
      for (const rosterId of move.roster_ids) {
        if (!activity.has(rosterId)) {
          activity.set(rosterId, { rosterId, totalMoves: 0, adds: [], drops: [] });
        }
        const a = activity.get(rosterId)!;
        a.totalMoves++;
        if (move.adds) {
          for (const [playerId, addRosterId] of Object.entries(move.adds)) {
            if (addRosterId === rosterId) a.adds.push(playerId);
          }
        }
        if (move.drops) {
          for (const [playerId, dropRosterId] of Object.entries(move.drops)) {
            if (dropRosterId === rosterId) a.drops.push(playerId);
          }
        }
      }
    }

    return Array.from(activity.values()).sort((a, b) => b.totalMoves - a.totalMoves);
  }

  // ── Private Helpers ──────────────────────────────────────────────────────────

  private groupByMatchup(matchups: SleeperMatchup[]): Map<number, SleeperMatchup[]> {
    const map = new Map<number, SleeperMatchup[]>();
    for (const m of matchups) {
      if (!map.has(m.matchup_id)) map.set(m.matchup_id, []);
      map.get(m.matchup_id)!.push(m);
    }
    return map;
  }

  private updateStreak(
    map: Map<number, { result: 'W' | 'L' | 'T'; count: number }>,
    rosterId: number,
    result: 'W' | 'L' | 'T'
  ): void {
    const existing = map.get(rosterId);
    if (!existing || existing.result !== result) {
      map.set(rosterId, { result, count: 1 });
    } else {
      existing.count++;
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
