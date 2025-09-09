// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

// Development environment configuration (real Firebase config provided)
// NOTE: Firebase client config is NOT a secret; security relies on Firestore/Storage rules & App Check.
export const environment = {
  production: false,
  firebase: {
    apiKey: 'AIzaSyDfvZKiuhM5TCgvBOOoDs2bn749-uwiOOU',
    authDomain: 'sentri-guard.firebaseapp.com',
    projectId: 'sentri-guard',
    storageBucket: 'sentri-guard.firebasestorage.app',
    messagingSenderId: '253320309966',
    appId: '1:253320309966:web:8ae228027f3bffc4b5749f',
    measurementId: 'G-1517B88766'
  }
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
