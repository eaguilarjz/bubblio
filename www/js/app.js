angular.module('starter', ['ionic', 'ionic-material', 'starter.controllers', 'ngOpenFB', 'ngResource'])

.constant('RESTFUL_URL', 'http://54.68.138.70:3000/api')

<<<<<<< HEAD
=======
.constant('shopSettings',{

	payPalSandboxId :'Aan6bXOH_c9sGD60f--U_-KuikjH96jlLXZUERxtK_opXjNEcvBJrFctKTH3fUjUV3zmMfvXA3mSiIPd',
	payPalProductionId : '',
	payPalEnv: 'PayPalEnvironmentSandbox', // for testing production for production
	payPalShopName : 'Bubblio',
	payPalMerchantPrivacyPolicyURL : '',
	payPalMerchantUserAgreementURL : ''

})

>>>>>>> 7f41bb9249c5064b648a52768ca40bc7d19d68a1
.run(function($ionicPlatform) {
	
   //Parse Initialization
   Parse.initialize("yMlvcsS2rf3ktzvqMcCJcBP8JHS2I5D5YJYV3KUz", "htSsI0RdkOzBaLOKEjjnQVavjgCXzYN5Jm0opecR");

  $ionicPlatform.ready(function() {
   
    if(window.cordova && window.cordova.plugins.Keyboard) {
      cordova.plugins.Keyboard.hideKeyboardAccessoryBar(true);
    }
    if(window.StatusBar) {
      StatusBar.styleDefault();
    }
 

	//Parse-Facebook Initialization
    if(!(ionic.Platform.isIOS() || ionic.Platform.isAndroid())){
		window.fbAsyncInit = function() {
	       Parse.FacebookUtils.init({
	          appId      : '184619491871652', 
	          version    : 'v2.3',
	          xfbml      : true
	       });
  	   };
 
  		(function(d, s, id){
  			var js, fjs = d.getElementsByTagName(s)[0];
  			 if (d.getElementById(id)) {return;}
  		     js = d.createElement(s); js.id = id;
  		     js.src = "//connect.facebook.net/en_US/sdk.js";
  		     fjs.parentNode.insertBefore(js, fjs);
  		}(document, 'script', 'facebook-jssdk'));
	  }
  });
})

.config(function($stateProvider, $urlRouterProvider, $ionicConfigProvider) {
    
    $stateProvider.state('app', {
        url: '/app',
        abstract: true,
        templateUrl: 'templates/menu.html',
        controller: 'MenuCtrl'
    })
    
    .state('app.login', {
      url: '/login',
      cache: false,
      views: {
	      'menuContent': {
		      templateUrl: 'templates/login.html',
		      controller: 'LoginCtrl'
	      }
      }
    })
    
    .state('app.signup', {
      url: '/signup',
      views: {
	      'menuContent': {
		      templateUrl: 'templates/signup.html',
		      controller: 'LoginCtrl'
	      }
      }
    })
    
	.state('app.dashboard', {
      url: '/dashboard',
      cache: false,
      views: {
	      'menuContent': {
		      templateUrl: 'templates/dashboard.html',
		      controller: 'DashboardCtrl'
	      }
	    }
	})
    
    .state('app.profile', {
      url: '/profile',
      views: {
	      'menuContent': {
		      templateUrl: 'templates/profile.html',
		      controller: 'ProfileCtrl'
	      }}
    })

  .state('app.search', {
    url: '/search',
    views: {
      'menuContent': {
        templateUrl: 'templates/search.html',
        controller: 'SearchCtrl'
      }
    }
  })

  .state('app.confirmation', {
      url: '/confirmation',
      views: {
        'menuContent': {
          templateUrl: 'templates/confirmation.html',
          controller: 'ConfirmationCtrl'
        }
      }
    })
    .state('app.laundromats', {
      url: '/laundromats/:serviceId/:latitude/:longitude/:pickupDate/:deliveryDate',
      views: {
        'menuContent': {
          templateUrl: 'templates/laundromats.html',
          controller: 'LaundromatsCtrl'
        }
      }
    })

  .state('app.site', {
    url: '/laundromats/:siteId/:serviceId/:pickupDate/:deliveryDate',
    views: {
      'menuContent': {
        templateUrl: 'templates/laundromat.html',
        controller: 'LaundromatCtrl'
      }
    }
  });
    
    // if none of the above states are matched, use this as the fallback
    $urlRouterProvider.otherwise('/app/login');
});