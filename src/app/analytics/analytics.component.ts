import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LeagueStateService } from '../services/league-state.service';
import {
  SleeperService,
  PowerRanking,
  ScheduleLuck,
  ConsistencyRating,
  LineupEfficiency,
} from '../services/sleeper.service';

type Tab = 'power' | 'luck' | 'consistency' | 'efficiency';

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss',
})
export class AnalyticsComponent implements OnInit {
  readonly state = inject(LeagueStateService);
  private readonly sleeper = inject(SleeperService);

  activeTab = signal<Tab>('power');
  loading = signal(true);
  noData = signal(false);
  errorMsg = signal('');

  powerRankings = signal<PowerRanking[]>([]);
  scheduleLuck = signal<ScheduleLuck[]>([]);
  consistency = signal<ConsistencyRating[]>([]);
  lineupEfficiency = signal<LineupEfficiency[]>([]);

  readonly tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'power',       label: 'Power Rankings',    icon: '⚡' },
    { id: 'luck',        label: 'Schedule Luck',      icon: '🎲' },
    { id: 'consistency', label: 'Consistency',        icon: '📈' },
    { id: 'efficiency',  label: 'Lineup Efficiency',  icon: '🎯' },
  ];

  ngOnInit(): void {
    this.state.initialize();

    this.state.waitForLeague().subscribe({
      next: league => {
        const weeks = this.state.weeksPlayed;

        if (weeks === 0) {
          this.noData.set(true);
          this.loading.set(false);
          return;
        }

        this.sleeper.getFullSeasonMatchups(league.league_id, weeks).subscribe({
          next: matchupsByWeek => {
            this.powerRankings.set(this.sleeper.computePowerRankings(matchupsByWeek));
            this.scheduleLuck.set(this.sleeper.computeScheduleLuck(matchupsByWeek));
            this.consistency.set(this.sleeper.computeConsistencyRatings(matchupsByWeek));
            this.lineupEfficiency.set(this.sleeper.computeLineupEfficiency(matchupsByWeek, this.state.starterCount));
            this.loading.set(false);
          },
          error: (err: Error) => { this.loading.set(false); this.errorMsg.set(err.message); },
        });
      },
      error: (err: Error) => { this.loading.set(false); this.errorMsg.set(err.message); },
    });
  }

  teamName(rosterId: number): string {
    return this.state.teamName(rosterId);
  }

  avatarUrl(rosterId: number): string {
    return this.state.rosterAvatarUrl(rosterId);
  }

  // ── Power rankings helpers ─────────────────────────────────────────────────
  maxAvgPts(): number {
    return this.powerRankings()[0]?.avgPointsFor || 1;
  }

  trendIcon(team: PowerRanking): string {
    if (team.last3WeeksAvg > team.avgPointsFor + 5) return '🔥';
    if (team.last3WeeksAvg < team.avgPointsFor - 5) return '❄️';
    return '→';
  }

  trendClass(team: PowerRanking): string {
    if (team.last3WeeksAvg > team.avgPointsFor) return 'trend--up';
    if (team.last3WeeksAvg < team.avgPointsFor) return 'trend--down';
    return '';
  }

  // ── Schedule luck helpers ──────────────────────────────────────────────────
  maxLuckDelta(): number {
    return Math.max(...this.scheduleLuck().map(t => Math.abs(t.luckDelta)), 1);
  }

  luckLabel(delta: number): string {
    if (delta >= 2)   return 'Very Lucky';
    if (delta >= 0.5) return 'Lucky';
    if (delta <= -2)  return 'Unlucky';
    if (delta <= -0.5) return 'Slightly Unlucky';
    return 'Neutral';
  }

  luckBarWidth(delta: number): number {
    return Math.abs(delta) / this.maxLuckDelta() * 100;
  }

  // ── Consistency helpers ────────────────────────────────────────────────────
  maxStdDev(): number {
    return Math.max(...this.consistency().map(t => t.stdDev), 1);
  }

  // ── Efficiency helpers ─────────────────────────────────────────────────────
  efficiencyGrade(eff: number): string {
    if (eff >= 0.95) return 'A+';
    if (eff >= 0.90) return 'A';
    if (eff >= 0.85) return 'B+';
    if (eff >= 0.80) return 'B';
    if (eff >= 0.75) return 'C+';
    if (eff >= 0.70) return 'C';
    return 'D';
  }

  efficiencyGradeClass(eff: number): string {
    if (eff >= 0.90) return 'grade--a';
    if (eff >= 0.80) return 'grade--b';
    if (eff >= 0.70) return 'grade--c';
    return 'grade--d';
  }
}
