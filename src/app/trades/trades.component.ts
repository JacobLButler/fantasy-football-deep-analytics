import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, forkJoin, of } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { LeagueStateService } from '../services/league-state.service';
import {
  SleeperService,
  SleeperTransaction,
  SleeperTradedPick,
  SleeperLeagueUser,
  SleeperRoster,
} from '../services/sleeper.service';

interface EnrichedTrade {
  transaction_id: string;
  created: Date;
  sides: TradeSide[];
  leagueId: string;
}

interface TradeSide {
  rosterId: number;
  playersReceived: string[];
  picksReceived: SleeperTradedPick[];
}

interface SeasonOption {
  leagueId: string;
  season: string;
}

interface SeasonCache {
  users: SleeperLeagueUser[];
  rosters: SleeperRoster[];
  trades: EnrichedTrade[];
  /** Full-season fantasy points scored by each player (playerId → total pts) */
  playerTotals: Map<string, number>;
}

@Component({
  selector: 'app-trades',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './trades.component.html',
  styleUrl: './trades.component.scss',
})
export class TradesComponent implements OnInit {
  readonly state = inject(LeagueStateService);
  private readonly sleeper = inject(SleeperService);

  loading = signal(true);
  errorMsg = signal('');

  seasons = signal<SeasonOption[]>([]);
  selectedLeagueId = signal<string>('');   // '' = all seasons

  allTrades = signal<EnrichedTrade[]>([]);
  managerFilter = signal<string>('');
  playerFilter = signal<string>('');
  managerOptions = signal<string[]>([]);
  playerOptions = signal<{ id: string; name: string }[]>([]);

  yearPickerOpen = signal(false);
  managerPickerOpen = signal(false);
  playerPickerOpen = signal(false);

  filteredTrades = computed(() => {
    let trades = this.allTrades();
    const mgr = this.managerFilter();
    if (mgr) trades = trades.filter(t =>
      t.sides.some(s => this.teamName(s.rosterId, t.leagueId) === mgr)
    );
    const pid = this.playerFilter();
    if (pid) trades = trades.filter(t =>
      t.sides.some(s => s.playersReceived.includes(pid))
    );
    return trades;
  });

  /** Top 5 most uneven trades from the current filtered view */
  lopsidedTrades = computed(() =>
    [...this.filteredTrades()]
      .filter(t => this.tradeTotalValue(t) > 0)
      .sort((a, b) => this.tradeLopsidedness(b) - this.tradeLopsidedness(a))
      .slice(0, 5)
  );

  selectedYearLabel = computed(() => {
    const id = this.selectedLeagueId();
    if (!id) return 'All Seasons';
    return this.seasons().find(s => s.leagueId === id)?.season ?? 'Season';
  });

  selectedManagerLabel = computed(() => this.managerFilter() || 'All Managers');

  selectedPlayerLabel = computed(() => {
    const pid = this.playerFilter();
    if (!pid) return 'All Players';
    return this.playerOptions().find(p => p.id === pid)?.name ?? 'All Players';
  });

  private readonly seasonCache = new Map<string, SeasonCache>();

  ngOnInit(): void {
    this.state.initialize();
    this.state.loadPlayers();

    this.state.waitForLeague().subscribe({
      next: league => {
        this.sleeper.getLeagueHistory(league.league_id).subscribe({
          next: history => {
            const opts = history.map(l => ({ leagueId: l.league_id, season: l.season }));
            this.seasons.set(opts);
            this.selectedLeagueId.set(opts[0]?.leagueId ?? league.league_id);
            this.loadScope();
          },
          error: () => {
            const opts = [{ leagueId: league.league_id, season: this.state.season }];
            this.seasons.set(opts);
            this.selectedLeagueId.set(league.league_id);
            this.loadScope();
          },
        });
      },
      error: (err: Error) => { this.loading.set(false); this.errorMsg.set(err.message); },
    });
  }

  selectYear(leagueId: string): void {
    this.yearPickerOpen.set(false);
    if (this.selectedLeagueId() === leagueId) return;
    this.selectedLeagueId.set(leagueId);
    this.managerFilter.set('');
    this.playerFilter.set('');
    this.loadScope();
  }

  selectManager(name: string): void {
    this.managerPickerOpen.set(false);
    this.managerFilter.set(name);
  }

  selectPlayer(playerId: string): void {
    this.playerPickerOpen.set(false);
    this.playerFilter.set(playerId);
  }

  private loadScope(): void {
    this.loading.set(true);
    this.allTrades.set([]);
    this.errorMsg.set('');

    const leagueId = this.selectedLeagueId();
    const toLoad = leagueId ? [leagueId] : this.seasons().map(s => s.leagueId);

    forkJoin(toLoad.map(id => this.fetchSeasonTrades(id))).subscribe({
      next: allArrays => {
        const merged = allArrays.flat().sort((a, b) => b.created.getTime() - a.created.getTime());
        this.allTrades.set(merged);
        this.managerOptions.set(this.buildManagerOptions(merged));
        this.playerOptions.set(this.buildPlayerOptions(merged));
        this.loading.set(false);
      },
      error: (err: Error) => { this.loading.set(false); this.errorMsg.set(err.message); },
    });
  }

  private fetchSeasonTrades(leagueId: string): Observable<EnrichedTrade[]> {
    const cached = this.seasonCache.get(leagueId);
    if (cached) return of(cached.trades);

    return this.sleeper.getLeagueSnapshot(leagueId).pipe(
      switchMap(snapshot => {
        const entry: SeasonCache = {
          users: snapshot.users,
          rosters: snapshot.rosters,
          trades: [],
          playerTotals: new Map(),
        };
        this.seasonCache.set(leagueId, entry);

        const playoffStart = snapshot.league.settings['playoff_week_start'] as number | undefined;
        const regularWeeks = playoffStart ? playoffStart - 1 : 14;
        const weeks = Math.min(regularWeeks, Math.max(this.state.currentWeek - 1, 1));

        return forkJoin({
          rawTrades: this.sleeper.getAllTrades(leagueId, weeks),
          matchups: this.sleeper.getFullSeasonMatchups(leagueId, weeks),
        }).pipe(
          map(({ rawTrades, matchups }) => {
            // Build full-season player point totals from matchup data
            for (const weekMatchups of matchups) {
              for (const m of weekMatchups) {
                for (const [pid, pts] of Object.entries(m.players_points ?? {})) {
                  entry.playerTotals.set(pid, (entry.playerTotals.get(pid) ?? 0) + pts);
                }
              }
            }
            const trades = rawTrades
              .sort((a, b) => b.created - a.created)
              .map(t => this.enrichTrade(t, leagueId));
            entry.trades = trades;
            return trades;
          })
        );
      })
    );
  }

  private enrichTrade(t: SleeperTransaction, leagueId: string): EnrichedTrade {
    const sides: TradeSide[] = t.roster_ids.map(rosterId => ({
      rosterId,
      playersReceived: t.adds
        ? Object.entries(t.adds).filter(([, to]) => to === rosterId).map(([pid]) => pid)
        : [],
      picksReceived: (t.draft_picks ?? []).filter(p => p.owner_id === rosterId),
    }));
    return { transaction_id: t.transaction_id, created: new Date(t.created), sides, leagueId };
  }

  private buildManagerOptions(trades: EnrichedTrade[]): string[] {
    const seen = new Set<string>();
    for (const trade of trades) {
      for (const side of trade.sides) {
        seen.add(this.teamName(side.rosterId, trade.leagueId));
      }
    }
    return Array.from(seen).sort();
  }

  private buildPlayerOptions(trades: EnrichedTrade[]): { id: string; name: string }[] {
    const seen = new Set<string>();
    const opts: { id: string; name: string }[] = [];
    for (const trade of trades) {
      for (const side of trade.sides) {
        for (const pid of side.playersReceived) {
          if (!seen.has(pid)) {
            seen.add(pid);
            opts.push({ id: pid, name: this.state.playerName(pid) });
          }
        }
      }
    }
    return opts.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Value helpers ────────────────────────────────────────────────────────────

  /** Sum of full-season points scored by the players a side received */
  sidePointValue(side: TradeSide, leagueId: string): number {
    const totals = this.seasonCache.get(leagueId)?.playerTotals;
    if (!totals) return 0;
    return side.playersReceived.reduce((sum, pid) => sum + (totals.get(pid) ?? 0), 0);
  }

  /** Combined player value of both sides (> 0 means we have real data) */
  tradeTotalValue(trade: EnrichedTrade): number {
    return trade.sides.reduce((sum, s) => sum + this.sidePointValue(s, trade.leagueId), 0);
  }

  /** Absolute point difference between the two sides */
  tradeLopsidedness(trade: EnrichedTrade): number {
    if (trade.sides.length < 2) return 0;
    return Math.abs(
      this.sidePointValue(trade.sides[0], trade.leagueId) -
      this.sidePointValue(trade.sides[1], trade.leagueId)
    );
  }

  /** Index of the winning side (most points received), or -1 if tied/no data */
  tradeWinnerIdx(trade: EnrichedTrade): number {
    if (trade.sides.length < 2) return -1;
    const a = this.sidePointValue(trade.sides[0], trade.leagueId);
    const b = this.sidePointValue(trade.sides[1], trade.leagueId);
    if (a === 0 && b === 0) return -1;
    if (a === b) return -1;
    return a > b ? 0 : 1;
  }

  /** Width % for the value bar of a given side */
  sideValuePct(side: TradeSide, trade: EnrichedTrade): number {
    const total = this.tradeTotalValue(trade);
    if (total === 0) return 50;
    return (this.sidePointValue(side, trade.leagueId) / total) * 100;
  }

  // ── Display helpers ──────────────────────────────────────────────────────────

  teamName(rosterId: number, leagueId: string): string {
    const cache = this.seasonCache.get(leagueId);
    const ownerId = cache?.rosters.find(r => r.roster_id === rosterId)?.owner_id;
    if (!ownerId) return `Team ${rosterId}`;

    const currentUser = this.state.leagueUsers$.value.find(u => u.user_id === ownerId);
    if (currentUser) {
      const custom = currentUser.metadata?.['team_name'] as string | undefined;
      return custom || currentUser.display_name || `Team ${rosterId}`;
    }

    const historicalUser = cache?.users.find(u => u.user_id === ownerId);
    const custom = historicalUser?.metadata?.['team_name'] as string | undefined;
    return custom || historicalUser?.display_name || `Team ${rosterId}`;
  }

  avatarUrl(rosterId: number, leagueId: string): string {
    const cache = this.seasonCache.get(leagueId);
    const ownerId = cache?.rosters.find(r => r.roster_id === rosterId)?.owner_id;
    if (ownerId) {
      const currentUser = this.state.leagueUsers$.value.find(u => u.user_id === ownerId);
      if (currentUser?.avatar) return `https://sleepercdn.com/avatars/thumbs/${currentUser.avatar}`;
      const historicalUser = cache?.users.find(u => u.user_id === ownerId);
      if (historicalUser?.avatar) return `https://sleepercdn.com/avatars/thumbs/${historicalUser.avatar}`;
    }
    return this.state.rosterAvatarUrl(rosterId);
  }

  playerName(playerId: string): string {
    return this.state.playerName(playerId);
  }

  playerPos(playerId: string): string {
    return this.state.playerPosition(playerId);
  }

  posClass(pos: string): string {
    const map: Record<string, string> = {
      QB: 'pos--qb', RB: 'pos--rb', WR: 'pos--wr',
      TE: 'pos--te', K: 'pos--k', DEF: 'pos--def',
    };
    return map[pos] ?? '';
  }

  pickLabel(pick: SleeperTradedPick): string {
    return `${pick.season} Rd ${pick.round}`;
  }

  hasAssets(side: TradeSide): boolean {
    return side.playersReceived.length > 0 || side.picksReceived.length > 0;
  }
}
