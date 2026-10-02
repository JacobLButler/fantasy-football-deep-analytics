import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { LeagueStateService } from '../services/league-state.service';

@Component({
  selector: 'app-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './nav.component.html',
  styleUrl: './nav.component.scss',
})
export class NavComponent implements OnInit {
  readonly state = inject(LeagueStateService);
  private readonly router = inject(Router);

  pickerOpen = signal(false);

  ngOnInit(): void {
    this.state.initialize();
  }

  selectLeague(leagueId: string): void {
    this.pickerOpen.set(false);
    this.state.switchLeague(leagueId);
    this.router.navigate(['/']);
  }
}
