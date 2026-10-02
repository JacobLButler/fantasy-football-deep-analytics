import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LeagueStateService } from '../services/league-state.service';
import { SleeperService, SleeperMatchup } from '../services/sleeper.service';

interface MatchupPair {
  matchupId: number;
  home: SleeperMatchup;
  away: SleeperMatchup;
}

@Component({
  selector: 'app-matchups',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './matchups.component.html',
  styleUrl: './matchups.component.scss',
})
export class MatchupsComponent implements OnInit {
  readonly state = inject(LeagueStateService);
  private readonly sleeper = inject(SleeperService);

  matchups = signal<MatchupPair[]>([]);
  week = signal(1);
  loading = signal(true);
  errorMsg = signal('');

  ngOnInit(): void {
    this.state.initialize();

    this.state.waitForLeague().subscribe({
      next: league => {
        this.week.set(this.state.currentWeek);
        this.loadWeek(this.state.currentWeek);
      },
      error: (err: Error) => { this.loading.set(false); this.errorMsg.set(err.message); },
    });
  }

  loadWeek(week: number): void {
    this.loading.set(true);
    this.week.set(week);
    this.sleeper.getMatchups(this.state.leagueId, week).subscribe({
      next: raw => { this.matchups.set(this.pairMatchups(raw)); this.loading.set(false); },
      error: (err: Error) => { this.loading.set(false); this.errorMsg.set(err.message); },
    });
  }

  prevWeek(): void {
    if (this.week() > 1) this.loadWeek(this.week() - 1);
  }

  nextWeek(): void {
    if (this.week() < this.state.currentWeek) this.loadWeek(this.week() + 1);
  }

  private pairMatchups(raw: SleeperMatchup[]): MatchupPair[] {
    const byId = new Map<number, SleeperMatchup[]>();
    for (const m of raw) {
      if (!byId.has(m.matchup_id)) byId.set(m.matchup_id, []);
      byId.get(m.matchup_id)!.push(m);
    }
    const pairs: MatchupPair[] = [];
    for (const [matchupId, pair] of byId) {
      if (pair.length === 2) {
        const [a, b] = (pair[0].points ?? 0) >= (pair[1].points ?? 0) ? [pair[0], pair[1]] : [pair[1], pair[0]];
        pairs.push({ matchupId, home: a, away: b });
      }
    }
    return pairs.sort((a, b) =>
      ((b.home.points ?? 0) + (b.away.points ?? 0)) - ((a.home.points ?? 0) + (a.away.points ?? 0))
    );
  }

  teamName(rosterId: number): string {
    return this.state.teamName(rosterId);
  }

  avatarUrl(rosterId: number): string {
    return this.state.rosterAvatarUrl(rosterId);
  }

  scorePct(home: number | null, away: number | null): number {
    const h = home ?? 0;
    const a = away ?? 0;
    const total = h + a;
    return total > 0 ? (h / total) * 100 : 50;
  }

  topScorer(matchup: SleeperMatchup): { name: string; pts: number } | null {
    if (!matchup.players_points || !matchup.starters?.length) return null;
    let topId = '';
    let topPts = -1;
    for (const pid of matchup.starters) {
      const pts = matchup.players_points[pid] ?? 0;
      if (pts > topPts) { topPts = pts; topId = pid; }
    }
    return topId ? { name: this.state.playerName(topId), pts: topPts } : null;
  }
}
