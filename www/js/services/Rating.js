angular.module('starter').factory('Rating', function() {
    return {
        getImages: function(score) {
            var images = [];
            var wholeStars = Math.floor(score);
            var halfStars = 0;
            
            // Determine the last star
            if ((score - wholeStars) < 0.15) {
                halfStars = 0;
            } else if ((score - wholeStars) < 0.85) {
                halfStars = 1;
            } else {
                wholeStars += 1;
            } 
            
            // Fill the array
            for (var i=0; i < 5; i++) {
                if (i < wholeStars) {
                    images[i] = { url: "img/star_full.gif" };
                } else if (i === wholeStars && halfStars === 1) {
                    images[i] = { url: "img/star_half.gif" };
                } else {
                    images[i] = { url: "img/star_none.gif" };
                }
            }
            
            return images;
        }
    };
});