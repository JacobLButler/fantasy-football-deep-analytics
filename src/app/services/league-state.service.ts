import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, forkJoin } from 'rxjs';
import { filter, switchMap, take } from 'rxjs/operators';
import {
  SleeperService,
  SleeperUser,
  SleeperLeague,
  SleeperRoster,
  SleeperLeagueUser,
  SleeperNflState,
  SleeperPlayer,
} from './sleeper.service';

@Injectable({ providedIn: 'root' })
export class LeagueStateService {
  private readonly sleeper = inject(SleeperService);

  // ── Config ─────────────────────────────────────────────────────────────────
  /** Change this to the Sleeper username of any league member */
  readonly username = 'jakebutler1997';

  // ── Core state streams ─────────────────────────────────────────────────────
  readonly user$         = new BehaviorSubject<SleeperUser | null>(null);
  readonly league$       = new BehaviorSubject<SleeperLeague | null>(null);
  readonly allLeagues$   = new BehaviorSubject<SleeperLeague[]>([]);
  readonly rosters$      = new BehaviorSubject<SleeperRoster[]>([]);
  readonly leagueUsers$  = new BehaviorSubject<SleeperLeagueUser[]>([]);
  readonly nflState$     = new BehaviorSubject<SleeperNflState | null>(null);
  readonly players$      = new BehaviorSubject<Record<string, SleeperPlayer> | null>(null);
  readonly loading$      = new BehaviorSubject<boolean>(false);
  readonly error$        = new BehaviorSubject<string | null>(null);

  private initialized = false;
  private selectedLeagueId: string | null = null;

  // ── Computed helpers ───────────────────────────────────────────────────────
  get leagueId(): string { return this.league$.value?.league_id ?? ''; }

  get currentWeek(): number { return this.nflState$.value?.week ?? 1; }

  get season(): string { return this.nflState$.value?.season ?? new Date().getFullYear().toString(); }

  /** Number of regular-season weeks before playoffs */
  get regularSeasonWeeks(): number {
    const start = this.league$.value?.settings['playoff_week_start'] as number | undefined;
    return start ? start - 1 : 14;
  }

  /** Number of weeks already completed (safe to fetch matchups for) */
  get weeksPlayed(): number {
    return Math.max(Math.min(this.currentWeek - 1, this.regularSeasonWeeks), 0);
  }

  /** Starter slot count (excludes BN and IR) */
  get starterCount(): number {
    return (this.league$.value?.roster_positions ?? [])
      .filter(p => p !== 'BN' && p !== 'IR').length || 9;
  }

  /** Number of teams that make the playoffs */
  get playoffTeams(): number {
    return (this.league$.value?.settings['playoff_teams'] as number) ?? 6;
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  /**
   * Idempotent — safe to call from multiple components.
   * Fetches user → NFL state → leagues → league snapshot in sequence.
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.loading$.next(true);

    forkJoin({
      user: this.sleeper.getUserByUsername(this.username),
      nflState: this.sleeper.getNflState(),
    }).pipe(
      switchMap(({ user, nflState }) => {
        this.user$.next(user);
        this.nflState$.next(nflState);
        return this.sleeper.getLeaguesForUser(user.user_id, 'nfl', nflState.season);
      }),
      switchMap(leagues => {
        if (!leagues?.length) throw new Error('No NFL leagues found for this user');
        this.allLeagues$.next(leagues);
        const savedId = this.selectedLeagueId
          ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('sleeperSelectedLeagueId') : null);
        const target = savedId ? (leagues.find(l => l.league_id === savedId) ?? leagues[0]) : leagues[0];
        return this.sleeper.getLeagueSnapshot(target.league_id);
      })
    ).subscribe({
      next: ({ league, users, rosters }) => {
        this.league$.next(league);
        this.leagueUsers$.next(users);
        this.rosters$.next(rosters);
        this.loading$.next(false);
      },
      error: (err: Error) => {
        this.error$.next(err.message ?? 'Failed to load league data');
        this.loading$.next(false);
      },
    });
  }

  /**
   * Resolves with the league once loaded, or errors if initialization failed.
   * Use this in components instead of subscribing to league$ directly so that
   * errors surface and the spinner doesn't block forever.
   */
  waitForLeague(): Observable<SleeperLeague> {
    return new Observable<SleeperLeague>(observer => {
      const leagueSub = this.league$
        .pipe(filter(l => !!l), take(1))
        .subscribe(l => { observer.next(l!); observer.complete(); });

      const errorSub = this.error$
        .pipe(filter(e => !!e), take(1))
        .subscribe(e => { observer.error(new Error(e ?? 'League failed to load')); });

      return () => { leagueSub.unsubscribe(); errorSub.unsubscribe(); };
    });
  }

  /**
   * Lazily load the full NFL player dictionary (~8 MB).
   * Only call on pages that need player names (e.g. Trades).
   */
  loadPlayers(): void {
    if (this.players$.value) return;
    this.sleeper.getAllPlayers().subscribe(players => this.players$.next(players));
  }

  /**
   * Switch the active league and re-initialize.
   * Persists the selection in localStorage.
   */
  switchLeague(leagueId: string): void {
    this.selectedLeagueId = leagueId;
    if (typeof localStorage !== 'undefined') localStorage.setItem('sleeperSelectedLeagueId', leagueId);
    this.initialized = false;
    this.league$.next(null);
    this.rosters$.next([]);
    this.leagueUsers$.next([]);
    this.error$.next(null);
    this.initialize();
  }

  // ── Display helpers ────────────────────────────────────────────────────────

  teamName(rosterId: number): string {
    const roster = this.rosters$.value.find(r => r.roster_id === rosterId);
    if (!roster) return `Team ${rosterId}`;
    const user = this.leagueUsers$.value.find(u => u.user_id === roster.owner_id);
    const custom = user?.metadata?.['team_name'] as string | undefined;
    return custom || user?.display_name || `Team ${rosterId}`;
  }

  ownerDisplayName(rosterId: number): string {
    const roster = this.rosters$.value.find(r => r.roster_id === rosterId);
    if (!roster) return '';
    return this.leagueUsers$.value.find(u => u.user_id === roster.owner_id)?.display_name ?? '';
  }

  avatarUrl(avatarId: string | null | undefined): string {
    return avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : '';
  }

  rosterAvatarUrl(rosterId: number): string {
    const roster = this.rosters$.value.find(r => r.roster_id === rosterId);
    const user = this.leagueUsers$.value.find(u => u.user_id === roster?.owner_id);
    return this.avatarUrl(user?.avatar);
  }

  playerName(playerId: string): string {
    const p = this.players$.value?.[playerId];
    if (!p) return playerId;
    return p.full_name || `${p.first_name} ${p.last_name}`;
  }

  playerPosition(playerId: string): string {
    return this.players$.value?.[playerId]?.position ?? '';
  }
}
