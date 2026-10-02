import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';  
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { of, from, pipe, filter, map } from 'rxjs';
import { SleeperService } from '../services/sleeper.service';


@Component({
  selector: 'app-entry-screen',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './entry-screen.component.html',
  styleUrls: ['./entry-screen.component.css']
})
export class EntryScreenComponent implements OnInit {

  public userForm: FormGroup;
  stateArray = from(['Alabama','Alaska','American Samoa','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','District of Columbia','Federated States of Micronesia','Florida','Georgia','Guam','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Marshall Islands','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Northern Mariana Islands','Ohio','Oklahoma','Oregon','Palau','Pennsylvania','Puerto Rico','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virgin Island','Virginia','Washington','West Virginia','Wisconsin','Wyoming'])


  constructor(private http: HttpClient, private formBuilder: FormBuilder, private sleeperService: SleeperService) {
    this.userForm = this.formBuilder.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
      secondaryInformation: this.formBuilder.group({
        age: [''],
        address: ['']
      })
    });

  }
//https://api.sleeper.app/v1/user/jakebutler1997
ngOnInit() {
  this.http.get('https://api.sleeper.app/v1/user/jakebutler1997')
    .subscribe({
      next: (data) => console.log(data),
      error: (err) => console.error('Error:', err)
    });

    this.formatStateArray();
    console.log(this.stateArray);
}

  onSubmit() {
    if (this.userForm.valid) {
      console.log('Form Submitted!', this.userForm.value);
    } else {
      console.log('Form is invalid');
    }
  }

  formatStateArray() {
    // Keep `stateArray` as an Observable. Pipe and subscribe without
    // reassigning the Subscription back to the variable (that would overwrite
    // the Observable with a Subscription and break future piping).
    this.stateArray.pipe(
      filter(state => state.length > 5),
      map(state => state.toUpperCase())
    ).subscribe({
      next: v => console.log(v),
      error: err => console.error('State stream error:', err),
      complete: () => console.log('State stream complete')
    });

    console.log('stateArray (Observable):', this.stateArray);
  }
}
