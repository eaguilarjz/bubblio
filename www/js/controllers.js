/* global angular, document, window */
angular.module('starter.controllers', [])

.controller('AppCtrl', function($scope, $ionicModal, $ionicPopover, $timeout, $location, $state, $ionicHistory, $ionicPopup) {

$scope.forgotPassword = function() {

$scope.data = {}

var forgotPasswordPopup = $ionicPopup.show({
    template: '<input type="text" ng-model="data.email">',
    title: 'Forgot Password',
    subTitle: 'Please enter your e-mail address',
    scope: $scope,
    buttons: [
      { text: 'Cancel' },
      {
        text: '<b>Submit</b>',
        type: 'button-positive',
        onTap: function(e) {
          if ($scope.data.email) {
            Parse.User.requestPasswordReset($scope.data.email, {
			success: function() {
				$ionicPopup.alert({
			     title: 'Password request change',
			     template: 'Please check your e-mail'
			   });

			},
			error: function(error) {
				alert("Error: " + error.code + " " + error.message);
				e.preventDefault();
		    }
		    });


            e.preventDefault();
          } else {
            $ionicPopup.alert({
			     title: 'Excuse me...',
			     template: 'Please check your e-mail'
			   });
			    e.preventDefault();

          }
        }
      }
    ]
  });
}

var navIcons = document.getElementsByClassName('ion-navicon');
for (var i = 0; i < navIcons.length; i++) {
navIcons[i].addEventListener('click', function() {
    this.classList.toggle('active');
});
}

////////////////////////////////////////
// Layout Methods
////////////////////////////////////////

$scope.hideNavBar = function() {
document.getElementsByTagName('ion-nav-bar')[0].style.display = 'none';
};

$scope.showNavBar = function() {
document.getElementsByTagName('ion-nav-bar')[0].style.display = 'block';
};

$scope.noHeader = function() {
var content = document.getElementsByTagName('ion-content');
for (var i = 0; i < content.length; i++) {
    if (content[i].classList.contains('has-header')) {
        content[i].classList.toggle('has-header');
    }
}
};

$scope.setExpanded = function(bool) {
$scope.isExpanded = bool;
};

$scope.setHeaderFab = function(location) {
var hasHeaderFabLeft = false;
var hasHeaderFabRight = false;

switch (location) {
    case 'left':
        hasHeaderFabLeft = true;
        break;
    case 'right':
        hasHeaderFabRight = true;
        break;
}

$scope.hasHeaderFabLeft = hasHeaderFabLeft;
$scope.hasHeaderFabRight = hasHeaderFabRight;
};

$scope.hasHeader = function() {
var content = document.getElementsByTagName('ion-content');
for (var i = 0; i < content.length; i++) {
    if (!content[i].classList.contains('has-header')) {
        content[i].classList.toggle('has-header');
    }
}

};

$scope.hideHeader = function() {
$scope.hideNavBar();
$scope.noHeader();
};

$scope.showHeader = function() {
$scope.showNavBar();
$scope.hasHeader();
};

$scope.clearFabs = function() {
var fabs = document.getElementsByClassName('button-fab');
if (fabs.length && fabs.length > 1) {
    fabs[0].remove();
}
};


// .fromTemplate() method
var template =  '<ion-popover-view>' +
            '   <ion-header-bar>' +
            '       <h1 class="title">My Popover Title</h1>' +
            '   </ion-header-bar>' +
            '   <ion-content class="padding">' +
            '       My Popover Contents' +
            '   </ion-content>' +
            '</ion-popover-view>';

$scope.popover = $ionicPopover.fromTemplate(template, {
scope: $scope
});
$scope.closePopover = function() {
$scope.popover.hide();
};
//Cleanup the popover when we're done with it!
$scope.$on('$destroy', function() {
$scope.popover.remove();
});

})

//Login Controller
.controller('LoginCtrl', function($scope, $stateParams, $location, $state, $ionicHistory, $ionicLoading, $ionicPopup, ionicMaterialInk) {

	$scope.data = {};

	$scope.signup = function(){

	  $scope.loading = $ionicLoading.show({
            content: 'Logging in',
            animation: 'fade-in',
            showBackdrop: true,
            maxWidth: 200,
            showDelay: 0
        });

	  //Create a new user on Parse
	  var user = new Parse.User();
	  user.set("username", $scope.data.email);
	  user.set("password", $scope.data.password);
	  user.set("email", $scope.data.email);
	  user.set("firstName", $scope.data.firstname);
	  user.set("lastName", $scope.data.lastname);

	  user.signUp(null, {
		    success: function(user) {

			  //prevent back button
		      $ionicHistory.nextViewOptions({
				  disableAnimate: true,
				  disableBack: true
			});

            $ionicLoading.hide();

			$scope.showAlert = function() {
			   var alertPopup = $ionicPopup.alert({
			     title: 'Welcome to bubbl.io!',
			     template: 'Usser successfully created'
			   });
			   alertPopup.then(function(res) {
			     console.log('User successfully created' + " " + Parse.User.current());
			   });
			 };

			//go to login window
			$state.goTo("app.login");
	    },
	    error: function(user, error) {

		  $ionicLoading.hide();
	      //show error
	      var alertPopup = $ionicPopup.alert({
			     title: 'Error',
			     template: error.message
			   });
			   alertPopup.then(function(res) {
			     console.log(error.code + " " + error.message);
			   });
	  }
  });

};

 $scope.login = function(){

	 $scope.loading = $ionicLoading.show({
            content: 'Logging in',
            animation: 'fade-in',
            showBackdrop: true,
            maxWidth: 200,
            showDelay: 5000
        });

	 Parse.User.logIn($scope.data.username, $scope.data.password, {
	    success: function(user) {
		    $ionicLoading.hide();
	    //login successful
	    	$ionicHistory.nextViewOptions({
			  disableAnimate: true,
			  disableBack: true
			});
			$state.go("app.dashboard");
	    },
	    error: function(user, error) {
		    $ionicLoading.hide();
	      //show error
	      var alertPopup = $ionicPopup.alert({
			     title: 'Error',
			     template: error.message
			   });
			   alertPopup.then(function(res) {
			     console.log(error.code + " " + error.message);
			   });
	    }
  });
  };

  $scope.loginFB = function(){
	  Parse.FacebookUtils.logIn(null, {
	  success: function(user) {
	    console.log(user);
	    if (!user.existed()) {
	      alert("User signed up and logged in through Facebook!");
	    } else {
	      alert("User logged in through Facebook!");
	    }
	  },
	  error: function(user, error) {
	    alert("User cancelled the Facebook login or did not fully authorize.");
	  }
	});

	 }

ionicMaterialInk.displayEffect();
})

//Menu Controller
.controller('MenuCtrl', function($scope, $ionicModal, $ionicPopover, $timeout, $location, $state, $ionicHistory, $ionicPopup) {

$scope.logout = function() {
	Parse.User.logOut();
	$state.go("app.login");
}
/*
	var currentUser = Parse.User.current();
	if (currentUser) {
		$scope.user = Parse.User.current();
	} else {
		alert("User is not logged in.");
	}
*/

})


//Dashboard Controller
.controller('DashboardCtrl', function($scope, $stateParams, $timeout, ionicMaterialInk, ionicMaterialMotion) {

	$timeout(function() {
			ionicMaterialMotion.fadeSlideIn({
			    selector: '.animate-fade-slide-in .item'
		});
	}, 200);
	ionicMaterialInk.displayEffect()

})

//OrderController
.controller('OrderCtrl', function($scope, $stateParams, $timeout, ionicMaterialInk, ionicMaterialMotion) {

	 google.maps.event.addDomListener(window, 'load', function() {
        var myLatlng = new google.maps.LatLng(37.3000, -120.4833);
 
        var mapOptions = {
            center: myLatlng,
            zoom: 16,
            mapTypeId: google.maps.MapTypeId.ROADMAP
        };
 
        var map = new google.maps.Map(document.getElementById("map"), mapOptions);
 
        navigator.geolocation.getCurrentPosition(function(pos) {
            map.setCenter(new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude));
            var myLocation = new google.maps.Marker({
                position: new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude),
                map: map,
                title: "My Location"
            });
        });
 
        $scope.map = map;
    });
	

	$timeout(function() {
			ionicMaterialMotion.fadeSlideIn({
			    selector: '.animate-fade-slide-in .item'
		});
	}, 200);
	ionicMaterialInk.displayEffect()

})

.controller('InkCtrl', function($scope, $stateParams, ionicMaterialInk) {
	ionicMaterialInk.displayEffect();
})

.controller('ComponentsCtrl', function($scope, $stateParams,  ionicMaterialInk) {
ionicMaterialInk.displayEffect();

// Toggle Code Wrapper
var code = document.getElementsByClassName('code-wrapper');
for (var i = 0; i < code.length; i++) {
code[i].addEventListener('click', function() {
    this.classList.toggle('active');
});
}
})

.controller('ListsCtrl', function($scope, $stateParams,  ionicMaterialMotion) {

var reset = function() {
var inClass = document.querySelectorAll('.in');
for (var i = 0; i < inClass.length; i++) {
    inClass[i].classList.remove('in');
    inClass[i].removeAttribute('style');
}
var done = document.querySelectorAll('.done');
for (var j = 0; j < done.length; j++) {
    done[j].classList.remove('done');
    done[j].removeAttribute('style');
}
var ionList = document.getElementsByTagName('ion-list');
for (var k = 0; k < ionList.length; k++) {
    var toRemove = ionList[k].className;
    if (/animate-/.test(toRemove)) {
        ionList[k].className = ionList[k].className.replace(/(?:^|\s)animate-\S*(?:$|\s)/, '');
    }
}
};

$scope.ripple = function() {
reset();
document.getElementsByTagName('ion-list')[0].className += ' animate-ripple';
setTimeout(function() {
    ionicMaterialMotion.ripple();
}, 500);
};

$scope.fadeSlideInRight = function() {
reset();
document.getElementsByTagName('ion-list')[0].className += ' animate-fade-slide-in-right';
setTimeout(function() {
    ionicMaterialMotion.fadeSlideInRight();
}, 500);
};

$scope.fadeSlideIn = function() {
reset();
document.getElementsByTagName('ion-list')[0].className += ' animate-fade-slide-in';
setTimeout(function() {
    ionicMaterialMotion.fadeSlideIn();
}, 500);
};

$scope.blinds = function() {
reset();
document.getElementsByTagName('ion-list')[0].className += ' animate-blinds';
setTimeout(function() {
    ionicMaterialMotion.blinds();
}, 500);
};

$scope.blinds();

})

.controller('SetupCtrl', function($scope, $stateParams) {
/* ionicMaterialMotion.pushDown({
selector: '.push-down'
});
*/
})

.controller('ExtensionsCtrl', function($scope, $stateParams, $ionicActionSheet, $timeout, $ionicLoading, $ionicModal, $ionicPopup,  ionicMaterialInk) {

// Triggered on a button click, or some other target
$scope.actionSheet = function() {

// Show the action sheet
var hideSheet = $ionicActionSheet.show({
    buttons: [{
        text: '<b>Share</b> This'
    }, {
        text: 'Move'
    }],
    destructiveText: 'Delete',
    titleText: 'Modify your album',
    cancelText: 'Cancel',
    cancel: function() {
        // add cancel code..
    },
    buttonClicked: function(index) {
        return true;
    }
});

// For example's sake, hide the sheet after two seconds
$timeout(function() {
    hideSheet();
}, 2000);

};

$scope.loading = function() {
$ionicLoading.show({
    template: '<div class="loader"><svg class="circular"><circle class="path" cx="50" cy="50" r="20" fill="none" stroke-width="2" stroke-miterlimit="10"/></svg></div>'
});

// For example's sake, hide the sheet after two seconds
$timeout(function() {
    $ionicLoading.hide();
}, 2000);
};

$ionicModal.fromTemplateUrl('my-modal.html', {
scope: $scope,
animation: 'slide-in-up'
}).then(function(modal) {
$scope.modal = modal;
});

$scope.openModal = function() {
$scope.modal.show();
$timeout(function () {
    $scope.modal.hide();
}, 2000);
};
// Cleanup the modal when we're done with it
$scope.$on('$destroy', function() {
$scope.modal.remove();
});

// Popover
$scope.popover = function() {
$scope.$parent.popover.show();
$timeout(function () {
    $scope.$parent.popover.hide();
}, 2000);
};

// Confirm
$scope.showPopup = function() {
var alertPopup = $ionicPopup.alert({
    title: 'You are now my subscribed to Cat Facts',
    template: 'You will meow receive fun daily facts about CATS!'
});

$timeout(function() {
    ionicMaterialInk.displayEffect();
}, 0);
};

// Toggle Code Wrapper
var code = document.getElementsByClassName('code-wrapper');
for (var i = 0; i < code.length; i++) {
code[i].addEventListener('click', function() {
    this.classList.toggle('active');
});
}
})

.controller('MotionCtrl', function($scope, $stateParams, $timeout,  ionicMaterialMotion, ionicMaterialInk) {
var fab = document.getElementById('fab');

$scope.moveFab = function(dir) {
fab.style.display = 'none';
fab.className = fab.className.replace('button-fab-top-left', '');
fab.className = fab.className.replace('button-fab-top-right', '');
fab.className = fab.className.replace('button-fab-bottom-left', '');
fab.className = fab.className.replace('button-fab-bottom-right', '');
fab.className += ' button-fab-' + dir;
$timeout(function() {
    fab.style.display = 'block';
}, 100);
};

$scope.motionFab = function(type) {
var shouldAnimate = false;
var classes = type instanceof Array ? type : [type];

function toggleMotionClass (theClass) {
    $timeout(function() {
        fab.classList.toggle(theClass);
    }, 300);
}

for (var i = 0; i < classes.length; i++) {
    fab.classList.toggle(classes[i]);

    shouldAnimate = fab.classList.contains(classes[i]);
    if (shouldAnimate) {
        (toggleMotionClass)(classes[i]);
    }
}
};

var reset = function() {
var inClass = document.querySelectorAll('.in');
for (var i = 0; i < inClass.length; i++) {
    inClass[i].classList.remove('in');
    inClass[i].removeAttribute('style');
}
var done = document.querySelectorAll('.done');
for (var j = 0; j < done.length; j++) {
    done[j].classList.remove('done');
    done[j].removeAttribute('style');
}
var ionList = document.getElementsByTagName('ion-list');
for (var k = 0; k < ionList.length; k++) {
    var toRemove = ionList[k].className;
    if (/animate-/.test(toRemove)) {
        ionList[k].className = ionList[k].className.replace(/(?:^|\s)animate-\S*(?:$|\s)/, '');
    }
}
};

$scope.ripple = function() {
reset();
document.getElementsByTagName('ion-list')[0].className += ' animate-ripple';
setTimeout(function() {
    ionicMaterialMotion.ripple();
}, 500);
};

$scope.fadeSlideInRight = function() {
reset();
document.getElementsByTagName('ion-list')[0].className += ' animate-fade-slide-in-right';
setTimeout(function() {
    ionicMaterialMotion.fadeSlideInRight();
}, 500);
};

$scope.fadeSlideIn = function() {
reset();
document.getElementsByTagName('ion-list')[0].className += ' animate-fade-slide-in';
setTimeout(function() {
    ionicMaterialMotion.fadeSlideIn();
}, 500);
};

$scope.blinds = function() {
reset();
document.getElementsByTagName('ion-list')[0].className += ' animate-blinds';
setTimeout(function() {
    ionicMaterialMotion.blinds();
}, 500);
};

$scope.blinds();
ionicMaterialInk.displayEffect();
});