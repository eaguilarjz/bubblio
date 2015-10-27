<<<<<<< HEAD
angular.module('starter', ['ionic', 'ionic-material', 'starter.controllers'])
=======
angular.module('starter', ['ionic', 'ionic-material', 'starter.controllers', 'ngOpenFB', 'ngResource'])

.constant('RESTFUL_URL', 'http://54.68.138.70:3000/api')
>>>>>>> 2ef126cc5fbdf9fa6b3bcb42b136460efefed1ea

.run(function($ionicPlatform) {
  $ionicPlatform.ready(function() {
    // Hide the accessory bar by default (remove this to show the accessory bar above the keyboard
    // for form inputs)
    if(window.cordova && window.cordova.plugins.Keyboard) {
      cordova.plugins.Keyboard.hideKeyboardAccessoryBar(true);
    }
    if(window.StatusBar) {
      StatusBar.styleDefault();
    }
 
    //Parse Initialization
    Parse.initialize("yMlvcsS2rf3ktzvqMcCJcBP8JHS2I5D5YJYV3KUz", "htSsI0RdkOzBaLOKEjjnQVavjgCXzYN5Jm0opecR");

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


.config(function($stateProvider, $urlRouterProvider) {
    $stateProvider

    .state('app', {
        url: '/app',
        abstract: true,
        templateUrl: 'templates/menu.html',
        controller: 'MenuCtrl'
    })
    
    .state('app.login', {
      url: '/login',
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
      views: {
	      'menuContent': {
		      templateUrl: 'templates/dashboard.html',
		      controller: 'DashboardCtrl'
	      },
	      'fabContent': {
                template: '<button id="fab-activity" class="button button-fab button-fab-top-right expanded button-energized-900 															flap"><i class="icon ion-paper-airplane"></i></button>',
                controller: function ($timeout) {
                    $timeout(function () {
                        document.getElementById('fab-activity').classList.toggle('on');
                    }, 200);
                }
            }
      }
    })
    
    .state('app.profile', {
      url: '/profile',
      views: {
	      'menuContent': {
		      templateUrl: 'templates/profile.html',
		      controller: 'DashboardCtrl'
	      },
	      'fabContent': {
                template: '<button id="fab-activity" class="button button-fab button-fab-top-right expanded button-energized-900 															flap"><i class="icon ion-paper-airplane"></i></button>',
                controller: function ($timeout) {
                    $timeout(function () {
                        document.getElementById('fab-activity').classList.toggle('on');
                    }, 200);
                }
            }
      }
    })
<<<<<<< HEAD
    
    .state('app.new-order', {
	    url: '/new-order',
	    views: {
		    'menuContent': {
			    templateUrl: 'templates/new_order.html',
			    controller: 'OrderCtrl'
		    }
	    }
=======

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
>>>>>>> 2ef126cc5fbdf9fa6b3bcb42b136460efefed1ea
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
    
     .state('app.view-map', {
	    url: '/view-map',
	    views: {
		    'menuContent': {
			    templateUrl: 'templates/view_map.html',
			    controller: 'OrderCtrl'
		    }
	    }
    })
    
    // if none of the above states are matched, use this as the fallback
    $urlRouterProvider.otherwise('/app/login');
});