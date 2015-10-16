/* global angular, document, window */
angular.module('starter.controllers', ['ngOpenFB'])

.controller('AppCtrl', function($scope, $ionicModal, $ionicPopover, $timeout, $location, $state, $ionicHistory, ngFB) {

var navIcons = document.getElementsByClassName('ion-navicon');
for (var i = 0; i < navIcons.length; i++) {
navIcons[i].addEventListener('click', function() {
    this.classList.toggle('active');
});
}

var fab = document.getElementById('fab');
fab.addEventListener('click', function() {
return window && window.alert ? window.alert('you clicked the FAB!') : undefined;
});


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
.controller('LoginCtrl', function($scope, $stateParams, $location, $state, $ionicHistory, ionicMaterialInk) {

	$scope.data = {};
	
		
	$scope.goto = function(location) {
		$ionicHistory.nextViewOptions({
			  disableAnimate: true,
			  disableBack: true
		});
		$state.go(location);	
	};
	
	$scope.signup = function(){  
	 
	 
	 
	  //Create a new user on Parse
	  var user = new Parse.User();
	  user.set("username", $scope.data.email);
	  user.set("password", $scope.data.password);
	  user.set("email", $scope.data.email);
	
	  console.log($scope.data.email);
	  
	  user.signUp(null, {
	    success: function(user) {
	      // Hooray! Let them use the app now.
	      alert("success!");
	    },
	    error: function(user, error) {
	      // Show the error message somewhere and let the user try again.
	      alert("Error: " + error.code + " " + error.message);
	  }
  });
 
};
 
 $scope.login = function(){
	 Parse.User.logIn($scope.data.username, $scope.data.password, {
	    success: function(user) {
	      // Do stuff after successful login.
	      console.log(user);
	      goto("app.dashboard")
	    },
	    error: function(user, error) {
	      // The login failed. Check error to see why.
	      alert("error!");
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


//Dashboard Controller
.controller('DashboardCtrl', function($scope, $stateParams, $timeout, ionicMaterialInk, ionicMaterialMotion, ngFB) {
	$scope.$parent.showHeader();
	$scope.$parent.clearFabs();
	$scope.isExpanded = true;
	$scope.$parent.setExpanded(true);
	$scope.$parent.setHeaderFab('right');
	
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