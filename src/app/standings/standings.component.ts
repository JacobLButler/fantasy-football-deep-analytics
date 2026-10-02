import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LeagueStateService } from '../services/league-state.service';
import { SleeperService, TeamStanding } from '../services/sleeper.service';

@Component({
  selector: 'app-standings',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './standings.component.html',
  styleUrl: './standings.component.scss',
})
export class StandingsComponent implements OnInit {
  readonly state = inject(LeagueStateService);
  private readonly sleeper = inject(SleeperService);

  standings = signal<TeamStanding[]>([]);
  loading = signal(true);
  errorMsg = signal('');

  ngOnInit(): void {
    this.state.initialize();

    this.state.waitForLeague().subscribe({
      next: league => {
        const weeks = this.state.weeksPlayed;

        if (weeks === 0) {
          this.standings.set(this.sleeper.computeStandings(this.state.rosters$.value, []));
          this.loading.set(false);
          return;
        }

        this.sleeper.getFullSeasonMatchups(league.league_id, weeks).subscribe({
          next: matchupsByWeek => {
            this.standings.set(this.sleeper.computeStandings(this.state.rosters$.value, matchupsByWeek));
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

  ownerName(rosterId: number): string {
    return this.state.ownerDisplayName(rosterId);
  }

  avatarUrl(rosterId: number): string {
    return this.state.rosterAvatarUrl(rosterId);
  }

  isPlayoffTeam(index: number): boolean {
    return index < this.state.playoffTeams;
  }

  isOnCutline(index: number): boolean {
    return index === this.state.playoffTeams - 1;
  }

  streakClass(streak: string): string {
    if (streak.startsWith('W')) return 'streak--win';
    if (streak.startsWith('L')) return 'streak--loss';
    return '';
  }

  rankClass(index: number): string {
    if (index === 0) return 'rank--gold';
    if (index === 1) return 'rank--silver';
    if (index === 2) return 'rank--bronze';
    return '';
  }
}
